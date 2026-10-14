/**
 * Orglet's own Google tools (2026-10-15). Google's remote MCP servers are a developer preview that refuses an app
 * outside the preview program, so the tools call Google's generally available REST APIs instead. They run inside the
 * core as one built-in MCP server named "Google"; the server record is an ordinary browser-sign-in server whose
 * address is this reserved name, which no network request is ever sent to, so every release that can read an MCP
 * server record can read it.
 */
export const GOOGLE_TOOLS_URL = 'https://google.tools.orglet.invalid/';
export const GOOGLE_TOOLS_NAME = 'Google';

/** The six preview servers an earlier build saved, one per service; they are replaced by the one built-in server. */
export const GOOGLE_LEGACY_SERVER_URLS: readonly string[] = [
  'https://sheetsmcp.googleapis.com/mcp/v1',
  'https://drivemcp.googleapis.com/mcp/v1',
  'https://gmailmcp.googleapis.com/mcp/v1',
  'https://calendarmcp.googleapis.com/mcp/v1',
  'https://docsmcp.googleapis.com/mcp/v1',
  'https://slidesmcp.googleapis.com/mcp/v1',
];

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/';

/**
 * What one consent asks for, the smallest set the tools need. In Google's classification `spreadsheets`,
 * `documents.readonly`, `presentations.readonly` and the two calendar scopes are sensitive; `drive.readonly`,
 * `gmail.readonly` and `gmail.compose` are restricted, which is what an unverified app is limited by (100 test users).
 */
export const GOOGLE_SCOPES: readonly string[] = [
  'spreadsheets',
  'documents.readonly',
  'presentations.readonly',
  'drive.readonly',
  'calendar.calendarlist.readonly',
  'calendar.events.readonly',
  'gmail.readonly',
  'gmail.compose',
].map(name => SCOPE_PREFIX + name);

export function isGoogleToolsUrl(address: string): boolean {
  return address === GOOGLE_TOOLS_URL;
}

export function isGoogleLegacyUrl(address: string): boolean {
  return GOOGLE_LEGACY_SERVER_URLS.includes(address);
}

/** Why a Google tool could not give an answer; the text is the short message the person (and the orglet) reads. */
export class GoogleToolError extends Error {}

const BARE_ID = /^[A-Za-z0-9_-]{10,}$/;
const ID_IN_PATH = /\/d\/([A-Za-z0-9_-]{10,})/;
const ID_IN_FOLDER = /\/folders\/([A-Za-z0-9_-]{10,})/;

/** The file id inside a Google Docs, Sheets, Slides or Drive address, or the id itself when one is given. */
export function googleResourceId(input: string): string {
  const text = input.trim();
  if (BARE_ID.test(text)) return text;
  let address: URL;
  try {
    address = new URL(text);
  } catch {
    throw new GoogleToolError('Không đọc được mã tài liệu. Dán địa chỉ Google đầy đủ hoặc mã của tệp.');
  }
  const fromPath = ID_IN_PATH.exec(address.pathname) ?? ID_IN_FOLDER.exec(address.pathname);
  const fromQuery = address.searchParams.get('id');
  const found = fromPath?.[1] ?? (fromQuery && BARE_ID.test(fromQuery) ? fromQuery : undefined);
  if (!found || !address.hostname.endsWith('google.com')) throw new GoogleToolError('Không đọc được mã tài liệu. Dán địa chỉ Google đầy đủ hoặc mã của tệp.');
  return found;
}
