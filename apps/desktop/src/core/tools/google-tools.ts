import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GoogleToolError, googleResourceId } from '../../shared/google-tools';
import type { GoogleApi } from './google-api';
import { capText, docsText, draftMessage, mailAttachmentNames, mailBodyText, rowsText, slideLines } from './google-text';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DOCS = 'https://docs.googleapis.com/v1/documents';
const SLIDES = 'https://slides.googleapis.com/v1/presentations';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';
const PLAIN_FILE_BYTES = 1_000_000;
const SEARCH_LIMIT = 50;
const EVENT_LIMIT = 100;
const WRITE_ROW_LIMIT = 500;

type Tool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  schema: z.ZodObject<Shape>;
  /** True for a tool that only reads; the others change something in the person's Google account. */
  readOnly: boolean;
  run: (api: GoogleApi, input: z.infer<z.ZodObject<Shape>>) => Promise<string>;
};

const file = z.string().min(1).describe('Full Google address or the file ID.');
const range = z.string().min(1).max(200).describe('Cell range in A1 notation, for example "Sheet1!A1:D20", or "Sheet1" for the whole tab.');
const cells = z.array(z.array(z.union([z.string(), z.number(), z.boolean()]).transform(String)).max(100)).min(1).max(WRITE_ROW_LIMIT)
  .describe('Rows to write, each row an array of cells. A string starting with = is a formula.');
const count = (limit: number, fallback: number) => z.number().int().min(1).max(limit).default(fallback);

function define<Shape extends z.ZodRawShape>(tool: Tool<Shape>): Tool {
  return tool as unknown as Tool;
}

function escapeQueryText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const DRIVE_TYPES = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  folder: 'application/vnd.google-apps.folder',
  pdf: 'application/pdf',
} as const;

type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string; size?: string; owners?: { displayName?: string; emailAddress?: string }[] };

function driveLine(item: DriveFile): string {
  const owner = item.owners?.[0]?.displayName ?? item.owners?.[0]?.emailAddress ?? '';
  const parts = [`${item.name}`, item.mimeType.replace(GOOGLE_APPS_PREFIX, 'google-'), owner && `owner: ${owner}`, item.modifiedTime && `modified: ${item.modifiedTime}`, `id: ${item.id}`, item.webViewLink];
  return `- ${parts.filter(Boolean).join(' | ')}`;
}

function isoTime(value: string | undefined, fallback: Date): string {
  const date = value ? new Date(value) : fallback;
  if (Number.isNaN(date.getTime())) throw new GoogleToolError('Thời gian cần theo kiểu ISO 8601, ví dụ 2026-10-15T09:00:00+07:00.');
  return date.toISOString();
}

async function messageSummary(api: GoogleApi, messageId: string): Promise<string> {
  const message = await api.json<{ id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } }>(`${GMAIL}/messages/${messageId}`, {
    query: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] },
  });
  const header = (name: string) => message.payload?.headers?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return `- id: ${message.id} | ${header('Date')} | from: ${header('From')} | subject: ${header('Subject')}\n  ${message.snippet ?? ''}`;
}

export const GOOGLE_TOOLS: Tool[] = [
  define({
    name: 'sheets_get_spreadsheet',
    description: 'Get the title of a Google Sheets spreadsheet and its tabs with their sizes (rows and columns).',
    schema: z.object({ spreadsheet: file }),
    readOnly: true,
    async run(api, input) {
      const id = googleResourceId(input.spreadsheet);
      const result = await api.json<{ properties?: { title?: string }; spreadsheetUrl?: string; sheets?: { properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[] }>(`${SHEETS}/${id}`, {
        query: { fields: 'properties.title,spreadsheetUrl,sheets.properties(title,gridProperties)' },
      });
      const tabs = (result.sheets ?? []).map(tab => `- "${tab.properties?.title}" (${tab.properties?.gridProperties?.rowCount ?? '?'} rows x ${tab.properties?.gridProperties?.columnCount ?? '?'} columns)`);
      return [`Spreadsheet: ${result.properties?.title ?? ''}`, result.spreadsheetUrl ?? '', 'Tabs:', ...tabs].join('\n');
    },
  }),
  define({
    name: 'sheets_read_values',
    description: 'Read the values of a range in Google Sheets as displayed. One row per line, cells separated by tabs.',
    schema: z.object({ spreadsheet: file, range }),
    readOnly: true,
    async run(api, input) {
      const id = googleResourceId(input.spreadsheet);
      const result = await api.json<{ range?: string; values?: unknown[][] }>(`${SHEETS}/${id}/values/${encodeURIComponent(input.range)}`, { query: { valueRenderOption: 'FORMATTED_VALUE' } });
      const rows = result.values ?? [];
      return rows.length ? `Range ${result.range ?? input.range}:\n${rowsText(rows)}` : `Range ${result.range ?? input.range} is empty.`;
    },
  }),
  define({
    name: 'sheets_update_values',
    description: 'Overwrite the values of a range in Google Sheets. Replaces any data already in that range.',
    schema: z.object({ spreadsheet: file, range, values: cells }),
    readOnly: false,
    async run(api, input) {
      const id = googleResourceId(input.spreadsheet);
      const result = await api.json<{ updatedRange?: string; updatedCells?: number }>(`${SHEETS}/${id}/values/${encodeURIComponent(input.range)}`, {
        method: 'PUT', query: { valueInputOption: 'USER_ENTERED' }, body: { range: input.range, majorDimension: 'ROWS', values: input.values },
      });
      return `Wrote ${result.updatedCells ?? 0} cells to ${result.updatedRange ?? input.range}.`;
    },
  }),
  define({
    name: 'sheets_append_rows',
    description: 'Append rows after the last row of a table in Google Sheets without touching existing rows.',
    schema: z.object({ spreadsheet: file, range: range.describe('Tab or range holding the table, for example "Sheet1" or "Sheet1!A:D".'), values: cells }),
    readOnly: false,
    async run(api, input) {
      const id = googleResourceId(input.spreadsheet);
      const result = await api.json<{ updates?: { updatedRange?: string; updatedRows?: number } }>(`${SHEETS}/${id}/values/${encodeURIComponent(input.range)}:append`, {
        method: 'POST', query: { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }, body: { majorDimension: 'ROWS', values: input.values },
      });
      return `Appended ${result.updates?.updatedRows ?? input.values.length} rows to ${result.updates?.updatedRange ?? input.range}.`;
    },
  }),
  define({
    name: 'drive_search_files',
    description: 'Search Google Drive files by name, type or a Drive query. Returns name, type, owner, modified time, id and link, most recently modified first.',
    schema: z.object({
      name: z.string().max(200).optional().describe('Part of the file name.'),
      type: z.enum(['any', 'document', 'spreadsheet', 'presentation', 'folder', 'pdf']).default('any'),
      query: z.string().max(500).optional().describe('Advanced Drive query, for example "fullText contains \'report\'".'),
      maxResults: count(SEARCH_LIMIT, 20),
    }),
    readOnly: true,
    async run(api, input) {
      const clauses = ['trashed = false'];
      if (input.name) clauses.push(`name contains '${escapeQueryText(input.name)}'`);
      if (input.type !== 'any') clauses.push(`mimeType = '${DRIVE_TYPES[input.type]}'`);
      if (input.query) clauses.push(`(${input.query})`);
      const result = await api.json<{ files?: DriveFile[]; nextPageToken?: string }>(DRIVE, {
        query: {
          q: clauses.join(' and '), pageSize: input.maxResults, orderBy: 'modifiedTime desc', supportsAllDrives: true, includeItemsFromAllDrives: true,
          fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))',
        },
      });
      const files = result.files ?? [];
      if (!files.length) return 'No files found.';
      return capText([...files.map(driveLine), ...(result.nextPageToken ? [`[More results exist: showing the first ${files.length} files.]`] : [])].join('\n'));
    },
  }),
  define({
    name: 'drive_get_file',
    description: 'Get details of a Google Drive file: name, type, size, owner, created and modified time, link.',
    schema: z.object({ file }),
    readOnly: true,
    async run(api, input) {
      const item = await api.json<DriveFile & { createdTime?: string; description?: string }>(`${DRIVE}/${googleResourceId(input.file)}`, {
        query: { supportsAllDrives: true, fields: 'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,description,owners(displayName,emailAddress)' },
      });
      return [driveLine(item), item.size ? `Size: ${item.size} bytes` : '', item.createdTime ? `Created: ${item.createdTime}` : '', item.description ?? ''].filter(Boolean).join('\n');
    },
  }),
  define({
    name: 'drive_read_file',
    description: 'Read a Google Drive file as text: Google Docs and Slides as text, Google Sheets as CSV (first tab), and small text files.',
    schema: z.object({ file }),
    readOnly: true,
    async run(api, input) {
      const id = googleResourceId(input.file);
      const meta = await api.json<{ name: string; mimeType: string; size?: string }>(`${DRIVE}/${id}`, { query: { supportsAllDrives: true, fields: 'name,mimeType,size' } });
      const exported = { [`${GOOGLE_APPS_PREFIX}document`]: 'text/plain', [`${GOOGLE_APPS_PREFIX}presentation`]: 'text/plain', [`${GOOGLE_APPS_PREFIX}spreadsheet`]: 'text/csv' }[meta.mimeType];
      if (exported) return capText(`${meta.name}\n\n${await api.text(`${DRIVE}/${id}/export`, { mimeType: exported })}`);
      const isText = meta.mimeType.startsWith('text/') || meta.mimeType === 'application/json';
      if (!isText) throw new GoogleToolError('Tệp này không phải văn bản nên chưa đọc được. Dùng drive_get_file để xem thông tin.');
      if (Number(meta.size ?? 0) > PLAIN_FILE_BYTES) throw new GoogleToolError('Tệp văn bản này lớn hơn 1 MB nên chưa đọc.');
      return capText(`${meta.name}\n\n${await api.text(`${DRIVE}/${id}`, { alt: 'media', supportsAllDrives: true })}`);
    },
  }),
  define({
    name: 'docs_read_document',
    description: 'Read a Google Docs document as plain text, keeping headings (lines starting with #) and tables.',
    schema: z.object({ document: file }),
    readOnly: true,
    async run(api, input) {
      const result = await api.json<{ title?: string; body?: { content?: Parameters<typeof docsText>[0] } }>(`${DOCS}/${googleResourceId(input.document)}`);
      return capText(`Document: ${result.title ?? ''}\n\n${docsText(result.body?.content)}`);
    },
  }),
  define({
    name: 'slides_read_presentation',
    description: 'Read the text on each slide of a Google Slides presentation.',
    schema: z.object({ presentation: file }),
    readOnly: true,
    async run(api, input) {
      const result = await api.json<{ title?: string; slides?: { pageElements?: Parameters<typeof slideLines>[0] }[] }>(`${SLIDES}/${googleResourceId(input.presentation)}`);
      const slides = (result.slides ?? []).map((slide, index) => [`Slide ${index + 1}:`, ...slideLines(slide.pageElements)].join('\n'));
      return capText(`Presentation: ${result.title ?? ''}\n\n${slides.join('\n\n')}`);
    },
  }),
  define({
    name: 'calendar_list_calendars',
    description: 'List the calendars of the account in Google Calendar: calendar id, name, time zone, access role.',
    schema: z.object({}),
    readOnly: true,
    async run(api) {
      const result = await api.json<{ items?: { id: string; summary?: string; primary?: boolean; timeZone?: string; accessRole?: string }[] }>(`${CALENDAR}/users/me/calendarList`, {
        query: { maxResults: 100, fields: 'items(id,summary,primary,timeZone,accessRole)' },
      });
      const lines = (result.items ?? []).map(item => `- ${item.summary ?? ''}${item.primary ? ' (primary)' : ''} | id: ${item.id} | ${item.timeZone ?? ''} | ${item.accessRole ?? ''}`);
      return lines.length ? lines.join('\n') : 'No calendars.';
    },
  }),
  define({
    name: 'calendar_list_events',
    description: 'List events in a time range of Google Calendar in time order. Defaults to the next 7 days on the primary calendar.',
    schema: z.object({
      calendarId: z.string().min(1).max(300).default('primary').describe('Calendar id from calendar_list_calendars; "primary" is the main calendar.'),
      from: z.string().optional().describe('Start, ISO 8601. Defaults to now.'),
      to: z.string().optional().describe('End, ISO 8601. Defaults to 7 days later.'),
      query: z.string().max(200).optional().describe('Text to look for in events.'),
      maxResults: count(EVENT_LIMIT, 50),
    }),
    readOnly: true,
    async run(api, input) {
      const start = new Date();
      const result = await api.json<{ items?: { summary?: string; location?: string; htmlLink?: string; attendees?: unknown[]; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[]; nextPageToken?: string }>(
        `${CALENDAR}/calendars/${encodeURIComponent(input.calendarId)}/events`,
        {
          query: {
            singleEvents: true, orderBy: 'startTime', timeMin: isoTime(input.from, start), timeMax: isoTime(input.to, new Date(start.getTime() + 7 * 86_400_000)),
            maxResults: input.maxResults, q: input.query, fields: 'nextPageToken,items(summary,location,htmlLink,attendees,start,end)',
          },
        },
      );
      const lines = (result.items ?? []).map(item => {
        const when = `${item.start?.dateTime ?? item.start?.date ?? ''} → ${item.end?.dateTime ?? item.end?.date ?? ''}`;
        const extras = [item.location, item.attendees?.length ? `${item.attendees.length} attendees` : '', item.htmlLink].filter(Boolean);
        return `- ${when} | ${item.summary ?? '(no title)'}${extras.length ? ` | ${extras.join(' | ')}` : ''}`;
      });
      if (!lines.length) return 'No events in this range.';
      return capText([...lines, ...(result.nextPageToken ? [`[More events exist: showing the first ${lines.length} events.]`] : [])].join('\n'));
    },
  }),
  define({
    name: 'gmail_search_messages',
    description: 'Search Gmail messages with Gmail search syntax (for example "from:an subject:report after:2026/10/01"). Returns sender, subject, date and a snippet.',
    schema: z.object({ query: z.string().min(1).max(500), maxResults: count(25, 10) }),
    readOnly: true,
    async run(api, input) {
      const found = await api.json<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(`${GMAIL}/messages`, { query: { q: input.query, maxResults: input.maxResults } });
      const ids = (found.messages ?? []).map(message => message.id);
      if (!ids.length) return 'No messages found.';
      const lines: string[] = [];
      for (const messageId of ids) lines.push(await messageSummary(api, messageId));
      return capText(lines.join('\n'));
    },
  }),
  define({
    name: 'gmail_read_message',
    description: 'Read a Gmail message as text: sender, recipients, subject, date, body and attachment names. Needs a message id from gmail_search_messages.',
    schema: z.object({ message: z.string().regex(/^[A-Za-z0-9]{6,64}$/, 'Invalid message id.') }),
    readOnly: true,
    async run(api, input) {
      const message = await api.json<{ payload?: { headers?: { name: string; value: string }[]; mimeType?: string; filename?: string; body?: { data?: string }; parts?: never[] } }>(`${GMAIL}/messages/${input.message}`, { query: { format: 'full' } });
      const header = (name: string) => message.payload?.headers?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
      const attachments = message.payload ? mailAttachmentNames(message.payload) : [];
      const head = [`From: ${header('From')}`, `To: ${header('To')}`, `Subject: ${header('Subject')}`, `Date: ${header('Date')}`, ...(attachments.length ? [`Attachments: ${attachments.join(', ')}`] : [])];
      return capText(`${head.join('\n')}\n\n${message.payload ? mailBodyText(message.payload) : ''}`);
    },
  }),
  define({
    name: 'gmail_create_draft',
    description: 'Create a draft in Gmail for the person to review and send themselves. This tool never sends mail.',
    schema: z.object({
      to: z.string().min(3).max(500).describe('Recipient addresses, separated by commas.'),
      cc: z.string().max(500).optional(),
      subject: z.string().max(300),
      body: z.string().min(1).max(50_000).describe('Plain-text body of the message.'),
    }),
    readOnly: false,
    async run(api, input) {
      const result = await api.json<{ id?: string }>(`${GMAIL}/drafts`, { method: 'POST', body: { message: { raw: draftMessage(input) } } });
      return `Created a Gmail draft (id ${result.id ?? ''}). It has not been sent: the person opens Gmail to review and send it.`;
    },
  }),
];

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** One tool call: the arguments are checked first, and any failure comes back as a short message the orglet can read. */
export async function runGoogleTool(api: GoogleApi, name: string, rawArguments: unknown): Promise<CallToolResult> {
  const tool = GOOGLE_TOOLS.find(item => item.name === name);
  if (!tool) return errorResult('Công cụ Google này không tồn tại.');
  const parsed = tool.schema.safeParse(rawArguments ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return errorResult(`Invalid argument${issue?.path.length ? ` (${issue.path.join('.')})` : ''}: ${issue?.message ?? ''}`.trim());
  }
  try {
    return { content: [{ type: 'text', text: await tool.run(api, parsed.data) }] };
  } catch (error) {
    if (error instanceof GoogleToolError) return errorResult(error.message);
    return errorResult('Công cụ Google gặp lỗi. Thử lại sau.');
  }
}

/** The built-in MCP server: it lists these tools and runs them, with the hints the approval card and app triggers read. */
export function buildGoogleToolServer(api: GoogleApi): Server {
  const server = new Server({ name: 'Orglet Google', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GOOGLE_TOOLS.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }) as { type: 'object'; properties?: Record<string, unknown> },
      annotations: tool.readOnly ? { readOnlyHint: true, openWorldHint: true } : { readOnlyHint: false, destructiveHint: tool.name === 'sheets_update_values', openWorldHint: true },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async request => runGoogleTool(api, request.params.name, request.params.arguments));
  return server;
}
