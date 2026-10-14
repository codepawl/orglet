import { beforeEach, expect, it } from 'vitest';
import { GoogleApi, GoogleSession, GOOGLE_SIGN_IN_NEEDED, type GoogleFetch } from '../../apps/desktop/src/core/tools/google-api';
import { GOOGLE_TOOLS, runGoogleTool } from '../../apps/desktop/src/core/tools/google-tools';
import { GOOGLE_TEXT_CHARACTERS } from '../../apps/desktop/src/core/tools/google-text';
import { googleResourceId } from '../../apps/desktop/src/shared/google-tools';
import type { McpOAuthState } from '../../apps/desktop/src/shared/mcp';

/** Google's REST APIs, answered in memory: each test says what an address returns, and reads back what the tools asked. */
type Recorded = { method: string; url: URL; body: unknown };
type Answer = { status?: number; json?: unknown; text?: string };

const TOKEN_ENDPOINT = 'https://broker.example.test/google/token';
const SPREADSHEET = '1AbCdEfGhIjKlMnOpQrStUv';

let requests: Recorded[];
let answers: Map<string, Answer>;
let saved: McpOAuthState[];
let signInLost: number;
let validTokens: Set<string>;
let refreshStatus: number;

const fetchFn: GoogleFetch = async (input, init) => {
  const url = new URL(input);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' && init.headers && new Headers(init.headers).get('content-type') === 'application/json' ? JSON.parse(init.body) : init?.body;
  requests.push({ method, url, body });
  if (input === TOKEN_ENDPOINT) {
    if (refreshStatus !== 200) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: refreshStatus });
    validTokens.add('fresh-token');
    return new Response(JSON.stringify({ access_token: 'fresh-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
  }
  const token = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('authorization') ?? '')?.[1];
  if (!token || !validTokens.has(token)) return new Response('{}', { status: 401 });
  const answer = answers.get(`${method} ${url.origin}${decodeURIComponent(url.pathname)}`) ?? { status: 404, json: { error: { status: 'NOT_FOUND' } } };
  return new Response(answer.text ?? JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200 });
};

function api() {
  const state: McpOAuthState = {
    serverUrl: 'https://google.tools.orglet.invalid/', redirectUri: 'http://127.0.0.1:53127/callback',
    client: { client_id: 'client-id', redirect_uris: ['http://127.0.0.1:53127/callback'], token_endpoint_auth_method: 'none' },
    tokens: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'Bearer' },
    discovery: { authorizationServerUrl: 'https://accounts.example.test', authorizationServerMetadata: { issuer: 'https://accounts.example.test', authorization_endpoint: 'https://accounts.example.test/auth', token_endpoint: TOKEN_ENDPOINT } },
  };
  const session = new GoogleSession(state, next => { saved.push(next); }, fetchFn, { onSignInLost: () => { signInLost++; } });
  return new GoogleApi(session, fetchFn);
}

function answer(method: string, address: string, value: Answer) {
  answers.set(`${method} ${address}`, value);
}

async function run(name: string, args: unknown) {
  const result = await runGoogleTool(api(), name, args);
  const text = result.content.map(part => (part.type === 'text' ? part.text : '')).join('');
  return { isError: result.isError === true, text };
}

beforeEach(() => {
  requests = [];
  answers = new Map();
  saved = [];
  signInLost = 0;
  validTokens = new Set(['access-1']);
  refreshStatus = 200;
});

it('reads a file id from every kind of Google address, or from the id itself', () => {
  expect(googleResourceId(SPREADSHEET)).toBe(SPREADSHEET);
  expect(googleResourceId(`https://docs.google.com/spreadsheets/d/${SPREADSHEET}/edit#gid=0`)).toBe(SPREADSHEET);
  expect(googleResourceId(`https://docs.google.com/document/d/${SPREADSHEET}/edit?tab=t.0`)).toBe(SPREADSHEET);
  expect(googleResourceId(`https://docs.google.com/presentation/d/${SPREADSHEET}/edit`)).toBe(SPREADSHEET);
  expect(googleResourceId(`https://drive.google.com/file/d/${SPREADSHEET}/view?usp=sharing`)).toBe(SPREADSHEET);
  expect(googleResourceId(`https://drive.google.com/drive/folders/${SPREADSHEET}`)).toBe(SPREADSHEET);
  expect(googleResourceId(`https://drive.google.com/open?id=${SPREADSHEET}`)).toBe(SPREADSHEET);
  expect(() => googleResourceId('https://example.com/d/' + SPREADSHEET)).toThrow(/mã tài liệu/);
  expect(() => googleResourceId('not an address')).toThrow(/mã tài liệu/);
});

it('offers fourteen tools, and only the three that change something are not read-only', () => {
  expect(GOOGLE_TOOLS).toHaveLength(14);
  expect(GOOGLE_TOOLS.filter(tool => !tool.readOnly).map(tool => tool.name)).toEqual(['sheets_update_values', 'sheets_append_rows', 'gmail_create_draft']);
  expect(GOOGLE_TOOLS.some(tool => /send/.test(tool.name))).toBe(false);
});

it('sheets: gets the title and the tabs with their sizes from an address', async () => {
  answer('GET', `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`, { json: { properties: { title: 'Budget' }, spreadsheetUrl: 'https://docs.google.com/x', sheets: [{ properties: { title: 'Jan', gridProperties: { rowCount: 100, columnCount: 6 } } }] } });
  const result = await run('sheets_get_spreadsheet', { spreadsheet: `https://docs.google.com/spreadsheets/d/${SPREADSHEET}/edit` });
  expect(result.isError).toBe(false);
  expect(result.text).toContain('Spreadsheet: Budget');
  expect(result.text).toContain('- "Jan" (100 rows x 6 columns)');
  expect(requests[0].url.searchParams.get('fields')).toContain('sheets.properties');
  expect(requests[0].url.searchParams.get('fields')).toContain('gridProperties');
});

it('sheets: reads formatted values of a range and cuts a long table with a note', async () => {
  const rows = Array.from({ length: 600 }, (_, index) => [`name ${index}`, `${index}`]);
  answer('GET', `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/Jan!A1:B600`, { json: { range: 'Jan!A1:B600', values: rows } });
  const result = await run('sheets_read_values', { spreadsheet: SPREADSHEET, range: 'Jan!A1:B600' });
  expect(requests[0].url.searchParams.get('valueRenderOption')).toBe('FORMATTED_VALUE');
  expect(result.text).toContain('name 0\t0');
  expect(result.text).toContain('name 499\t499');
  expect(result.text).not.toContain('name 500\t');
  expect(result.text).toContain('Truncated: showing 500 of 600 rows.');
  answer('GET', `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/Empty`, { json: { range: 'Empty' } });
  expect((await run('sheets_read_values', { spreadsheet: SPREADSHEET, range: 'Empty' })).text).toContain('is empty');
});

it('sheets: updates a range and appends rows with the values the orglet gave', async () => {
  answer('PUT', `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/Jan!A1:B2`, { json: { updatedRange: 'Jan!A1:B2', updatedCells: 4 } });
  const update = await run('sheets_update_values', { spreadsheet: SPREADSHEET, range: 'Jan!A1:B2', values: [['a', 1], ['b', true]] });
  expect(update.text).toBe('Wrote 4 cells to Jan!A1:B2.');
  expect(requests[0].method).toBe('PUT');
  expect(requests[0].body).toEqual({ range: 'Jan!A1:B2', majorDimension: 'ROWS', values: [['a', '1'], ['b', 'true']] });
  expect(requests[0].url.searchParams.get('valueInputOption')).toBe('USER_ENTERED');
  answer('POST', `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/Jan:append`, { json: { updates: { updatedRange: 'Jan!A5:B5', updatedRows: 1 } } });
  const append = await run('sheets_append_rows', { spreadsheet: SPREADSHEET, range: 'Jan', values: [['x', 'y']] });
  expect(append.text).toBe('Appended 1 rows to Jan!A5:B5.');
  expect(requests[1].method).toBe('POST');
  expect(requests[1].url.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
  const tooMany = await run('sheets_append_rows', { spreadsheet: SPREADSHEET, range: 'Jan', values: Array.from({ length: 501 }, () => ['a']) });
  expect(tooMany.isError).toBe(true);
  expect(tooMany.text).toContain('Invalid argument');
});

it('drive: searches by name and type with quotes escaped, and lists name, type, owner, date, id and link', async () => {
  answer('GET', 'https://www.googleapis.com/drive/v3/files', { json: { files: [{ id: 'f1', name: 'Kế hoạch', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-01T00:00:00Z', webViewLink: 'https://docs.google.com/f1', owners: [{ displayName: 'An' }] }], nextPageToken: 'more' } });
  const result = await run('drive_search_files', { name: "An's plan", type: 'document', maxResults: 5 });
  const query = requests[0].url.searchParams;
  expect(query.get('q')).toBe("trashed = false and name contains 'An\\'s plan' and mimeType = 'application/vnd.google-apps.document'");
  expect(query.get('pageSize')).toBe('5');
  expect(query.get('orderBy')).toBe('modifiedTime desc');
  expect(result.text).toContain('- Kế hoạch | google-document | owner: An | modified: 2026-10-01T00:00:00Z | id: f1 | https://docs.google.com/f1');
  expect(result.text).toContain('More results exist: showing the first 1 files.');
  answer('GET', 'https://www.googleapis.com/drive/v3/files', { json: { files: [] } });
  expect((await run('drive_search_files', { query: "fullText contains 'x'" })).text).toBe('No files found.');
  expect(requests[1].url.searchParams.get('q')).toBe("trashed = false and (fullText contains 'x')");
});

it('drive: gets metadata, and reads Docs and Slides as text, Sheets as CSV, a small text file as is, and refuses the rest', async () => {
  answer('GET', 'https://www.googleapis.com/drive/v3/files/doc00000001', { json: { name: 'Doc', mimeType: 'application/vnd.google-apps.document' } });
  answer('GET', 'https://www.googleapis.com/drive/v3/files/doc00000001/export', { text: 'hello doc' });
  expect((await run('drive_read_file', { file: 'doc00000001' })).text).toBe('Doc\n\nhello doc');
  expect(requests.at(-1)!.url.searchParams.get('mimeType')).toBe('text/plain');
  answer('GET', 'https://www.googleapis.com/drive/v3/files/sheet0000001', { json: { name: 'Sheet', mimeType: 'application/vnd.google-apps.spreadsheet' } });
  answer('GET', 'https://www.googleapis.com/drive/v3/files/sheet0000001/export', { text: 'a,b\n1,2' });
  expect((await run('drive_read_file', { file: 'sheet0000001' })).text).toBe('Sheet\n\na,b\n1,2');
  expect(requests.at(-1)!.url.searchParams.get('mimeType')).toBe('text/csv');
  answer('GET', 'https://www.googleapis.com/drive/v3/files/text0000001', { json: { name: 'notes.txt', mimeType: 'text/plain', size: '12' } });
  expect((await run('drive_read_file', { file: 'text0000001' })).text).toContain('notes.txt');
  expect(requests.at(-1)!.url.searchParams.get('alt')).toBe('media');
  answer('GET', 'https://www.googleapis.com/drive/v3/files/image000001', { json: { name: 'p.png', mimeType: 'image/png' } });
  const image = await run('drive_read_file', { file: 'image000001' });
  expect(image.isError).toBe(true);
  expect(image.text).toContain('không phải văn bản');
  answer('GET', 'https://www.googleapis.com/drive/v3/files/huge0000001', { json: { name: 'big.txt', mimeType: 'text/plain', size: '5000000' } });
  expect((await run('drive_read_file', { file: 'huge0000001' })).text).toContain('lớn hơn 1 MB');
  answer('GET', 'https://www.googleapis.com/drive/v3/files/meta0000001', { json: { id: 'meta0000001', name: 'Folder', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-10-02T00:00:00Z' } });
  expect((await run('drive_get_file', { file: 'meta0000001' })).text).toContain('Folder | google-folder');
});

it('drive: cuts a long file to the character limit and says so', async () => {
  answer('GET', 'https://www.googleapis.com/drive/v3/files/long0000001', { json: { name: 'Long', mimeType: 'application/vnd.google-apps.document' } });
  answer('GET', 'https://www.googleapis.com/drive/v3/files/long0000001/export', { text: 'x'.repeat(GOOGLE_TEXT_CHARACTERS + 500) });
  const result = await run('drive_read_file', { file: 'long0000001' });
  expect(result.text).toContain(`Truncated: showing ${GOOGLE_TEXT_CHARACTERS} of ${GOOGLE_TEXT_CHARACTERS + 500 + 'Long\n\n'.length} characters.`);
  expect(Array.from(result.text).length).toBeLessThan(GOOGLE_TEXT_CHARACTERS + 200);
});

it('docs: reads a document as plain text with headings and table rows', async () => {
  answer('GET', `https://docs.googleapis.com/v1/documents/${SPREADSHEET}`, {
    json: {
      title: 'Report',
      body: {
        content: [
          { paragraph: { paragraphStyle: { namedStyleType: 'HEADING_2' }, elements: [{ textRun: { content: 'Overview\n' } }] } },
          { paragraph: { paragraphStyle: { namedStyleType: 'NORMAL_TEXT' }, elements: [{ textRun: { content: 'Plain ' } }, { textRun: { content: 'text\n' } }] } },
          { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'A\n' } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: 'B\n' } }] } }] }] }] } },
        ],
      },
    },
  });
  const result = await run('docs_read_document', { document: `https://docs.google.com/document/d/${SPREADSHEET}/edit` });
  expect(result.text).toBe('Document: Report\n\n## Overview\nPlain text\nA | B');
});

it('slides: reads the text of every slide, shapes and tables', async () => {
  answer('GET', `https://slides.googleapis.com/v1/presentations/${SPREADSHEET}`, {
    json: {
      title: 'Deck',
      slides: [
        { pageElements: [{ shape: { text: { textElements: [{ textRun: { content: 'Title\n' } }] } } }] },
        { pageElements: [{ table: { tableRows: [{ tableCells: [{ text: { textElements: [{ textRun: { content: 'Q1' } }] } }, { text: { textElements: [{ textRun: { content: '10' } }] } }] }] } }] },
      ],
    },
  });
  const result = await run('slides_read_presentation', { presentation: SPREADSHEET });
  expect(result.text).toBe('Presentation: Deck\n\nSlide 1:\nTitle\n\nSlide 2:\nQ1 | 10');
});

it('calendar: lists calendars, and events in a range with the primary calendar and seven days as defaults', async () => {
  answer('GET', 'https://www.googleapis.com/calendar/v3/users/me/calendarList', { json: { items: [{ id: 'me@example.test', summary: 'Me', primary: true, timeZone: 'Asia/Ho_Chi_Minh', accessRole: 'owner' }] } });
  expect((await run('calendar_list_calendars', {})).text).toBe('- Me (primary) | id: me@example.test | Asia/Ho_Chi_Minh | owner');
  answer('GET', 'https://www.googleapis.com/calendar/v3/calendars/primary/events', { json: { items: [{ summary: 'Standup', start: { dateTime: '2026-10-16T09:00:00+07:00' }, end: { dateTime: '2026-10-16T09:15:00+07:00' }, attendees: [{}, {}], htmlLink: 'https://calendar.example.test/e' }, { start: { date: '2026-10-17' }, end: { date: '2026-10-18' } }] } });
  const events = await run('calendar_list_events', {});
  const query = requests.at(-1)!.url.searchParams;
  expect(query.get('singleEvents')).toBe('true');
  expect(query.get('orderBy')).toBe('startTime');
  expect(new Date(query.get('timeMax')!).getTime() - new Date(query.get('timeMin')!).getTime()).toBe(7 * 86_400_000);
  expect(events.text).toContain('2026-10-16T09:00:00+07:00 → 2026-10-16T09:15:00+07:00 | Standup | 2 attendees | https://calendar.example.test/e');
  expect(events.text).toContain('(no title)');
  await run('calendar_list_events', { calendarId: 'a@b.test', from: '2026-10-20T00:00:00+07:00', to: '2026-10-21T00:00:00Z' });
  expect(requests.at(-1)!.url.pathname).toBe('/calendar/v3/calendars/a%40b.test/events');
  expect(requests.at(-1)!.url.searchParams.get('timeMin')).toBe('2026-10-19T17:00:00.000Z');
  const invalid = await run('calendar_list_events', { from: 'tomorrow-ish' });
  expect(invalid.isError).toBe(true);
  expect(invalid.text).toContain('ISO 8601');
});

it('gmail: searches with a metadata line per message, reads a body and its attachments, and cuts nothing it should not', async () => {
  answer('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages', { json: { messages: [{ id: 'aa11bb22' }] } });
  answer('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/aa11bb22', {
    json: {
      id: 'aa11bb22', snippet: 'Hello there',
      payload: {
        headers: [{ name: 'From', value: 'An <an@example.test>' }, { name: 'To', value: 'me@example.test' }, { name: 'Subject', value: 'Hi' }, { name: 'Date', value: 'Thu, 15 Oct 2026' }],
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from('Xin chào, đây là thư.', 'utf8').toString('base64url') } },
          { mimeType: 'application/pdf', filename: 'bill.pdf', body: {} },
        ],
      },
    },
  });
  const search = await run('gmail_search_messages', { query: 'from:an', maxResults: 3 });
  expect(requests[0].url.searchParams.get('q')).toBe('from:an');
  expect(requests[0].url.searchParams.get('maxResults')).toBe('3');
  expect(requests[1].url.searchParams.getAll('metadataHeaders')).toEqual(['From', 'Subject', 'Date']);
  expect(search.text).toBe('- id: aa11bb22 | Thu, 15 Oct 2026 | from: An <an@example.test> | subject: Hi\n  Hello there');
  const read = await run('gmail_read_message', { message: 'aa11bb22' });
  expect(read.text).toBe('From: An <an@example.test>\nTo: me@example.test\nSubject: Hi\nDate: Thu, 15 Oct 2026\nAttachments: bill.pdf\n\nXin chào, đây là thư.');
  expect((await run('gmail_read_message', { message: '../drafts' })).isError).toBe(true);
});

it('gmail: creates a draft, never sends it, and refuses a header with a line break', async () => {
  answer('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', { json: { id: 'draft-1' } });
  const result = await run('gmail_create_draft', { to: 'an@example.test', subject: 'Chào bạn', body: 'Nội dung thư' });
  expect(result.text).toContain('It has not been sent');
  const raw = (requests[0].body as { message: { raw: string } }).message.raw;
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  expect(mime).toContain('To: an@example.test');
  expect(mime).toContain(`Subject: =?UTF-8?B?${Buffer.from('Chào bạn').toString('base64')}?=`);
  expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
  expect(Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString('utf8')).toBe('Nội dung thư');
  expect(requests.every(request => !/send/i.test(request.url.pathname))).toBe(true);
  const injected = await run('gmail_create_draft', { to: 'an@example.test\r\nBcc: x@example.test', subject: 's', body: 'b' });
  expect(injected.isError).toBe(true);
  expect(requests).toHaveLength(1);
});

it('turns Google errors into short Vietnamese messages', async () => {
  const address = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`;
  const call = () => run('sheets_get_spreadsheet', { spreadsheet: SPREADSHEET });
  answer('GET', address, { status: 403, json: { error: { status: 'PERMISSION_DENIED' } } });
  expect((await call()).text).toBe('Tài khoản Google đang đăng nhập không có quyền với mục này. Nhờ chủ tệp chia sẻ cho tài khoản đó.');
  answer('GET', address, { status: 403, json: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } });
  expect((await call()).text).toBe('Google đang giới hạn số yêu cầu. Chờ một lát rồi thử lại.');
  answer('GET', address, { status: 403, json: { error: { errors: [{ reason: 'accessNotConfigured' }] } } });
  expect((await call()).text).toContain('chưa được bật');
  answer('GET', address, { status: 404, json: {} });
  expect((await call()).text).toBe('Không tìm thấy mục này trong Google. Kiểm tra lại địa chỉ hoặc mã.');
  answer('GET', address, { status: 429, json: {} });
  expect((await call()).text).toContain('giới hạn');
  answer('GET', address, { status: 503, json: {} });
  const unavailable = await call();
  expect(unavailable).toMatchObject({ isError: true, text: 'Google đang gặp lỗi. Thử lại sau ít phút.' });
  expect(signInLost).toBe(0);
});

it('refreshes once on a 401 and retries, saving the new token and keeping the refresh token', async () => {
  validTokens = new Set();
  answer('GET', `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`, { json: { properties: { title: 'Budget' } } });
  const result = await run('sheets_get_spreadsheet', { spreadsheet: SPREADSHEET });
  expect(result.text).toContain('Budget');
  const refresh = requests.find(request => request.url.href === TOKEN_ENDPOINT)!;
  expect(String(refresh.body)).toContain('grant_type=refresh_token');
  expect(String(refresh.body)).toContain('refresh_token=refresh-1');
  expect(String(refresh.body)).not.toContain('client_secret');
  expect(requests.filter(request => request.url.href === TOKEN_ENDPOINT)).toHaveLength(1);
  expect(saved.at(-1)!.tokens).toMatchObject({ access_token: 'fresh-token', refresh_token: 'refresh-1' });
});

it('says the sign-in is gone when the refresh is refused, and forgets the tokens', async () => {
  validTokens = new Set();
  refreshStatus = 400;
  const result = await run('sheets_get_spreadsheet', { spreadsheet: SPREADSHEET });
  expect(result).toEqual({ isError: true, text: GOOGLE_SIGN_IN_NEEDED });
  expect(signInLost).toBe(1);
  expect(saved.at(-1)!.tokens).toBeUndefined();
});

it('says the sign-in is gone when a fresh token is refused too', async () => {
  const lateApi = api();
  validTokens = new Set();
  const refused: GoogleFetch = async (input, init) => (input === TOKEN_ENDPOINT ? fetchFn(input, init) : new Response('{}', { status: 401 }));
  const stateOnly = new GoogleApi(new GoogleSession({ serverUrl: 'https://google.tools.orglet.invalid/', redirectUri: 'http://127.0.0.1:1/callback', client: { client_id: 'c' }, tokens: { access_token: 'a', refresh_token: 'r', token_type: 'Bearer' }, discovery: { authorizationServerMetadata: { token_endpoint: TOKEN_ENDPOINT } } }, () => {}, refused, { onSignInLost: () => { signInLost++; } }), refused);
  expect(lateApi).toBeDefined();
  const result = await runGoogleTool(stateOnly, 'calendar_list_calendars', {});
  expect(result.isError).toBe(true);
  expect(signInLost).toBe(1);
});

it('refuses unknown tools and bad arguments without calling Google', async () => {
  expect((await run('sheets_delete_everything', {})).isError).toBe(true);
  const missing = await run('sheets_read_values', { spreadsheet: SPREADSHEET });
  expect(missing.isError).toBe(true);
  expect(missing.text).toContain('range');
  expect(requests).toHaveLength(0);
});
