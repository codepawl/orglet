import type { Language } from '../../shared/i18n';
import { translate, translateMessage } from '../../shared/i18n';
import { en, enGB } from '../../shared/locales/en';
import type { ToolCapability } from '../../shared/tool-policy';
import type { WorkspacePermission } from '../../shared/workspace-access';
import type { ToolCallProblem } from '../tools/catalog';

/**
 * The permissions a chat has turned off, named the way the person sees them in the chat's Details (COD-257). Asked
 * to open a link with the web and the browser both off, an orglet used to answer "paste the page text", leaving the
 * person to do the work by hand when one switch would have let the orglet do it.
 */
export const PERMISSIONS_OFF_INSTRUCTION = 'These permissions are off in this chat, named as the person sees them. If the request needs one of them, say in one sentence which one to turn on and where, then do what you can without it.';

type HintInput = {
  capabilities: readonly ToolCapability[];
  workspacePermissions: readonly WorkspacePermission[] | undefined;
  language: Language;
  sideThread: boolean;
  /** A schedule's run: its browser can never act, so acting is not a switch to point at. */
  schedule?: boolean;
  /** Whether desktop apps work on this computer (Windows only); elsewhere there is no switch to point at. */
  desktopAvailable?: boolean;
};

/** Vietnamese labels as the controls show them; the dictionary gives the English ones. */
const SWITCH_LABELS: Partial<Record<ToolCapability, string>> = {
  'source.read': 'Đọc nguồn đính kèm',
  'dataset.check': 'Kiểm tra dữ liệu',
  'network.web': 'Đọc và tìm kiếm web',
};

function dictionaryFor(language: Language) {
  if (language === 'vi') return null;
  return language === 'en-GB' ? enGB : en;
}

/** One line per permission that is off, or none when everything the controls offer is on. */
export function permissionsOff(input: HintInput): { permissions: string[]; where: string } | null {
  const dictionary = dictionaryFor(input.language);
  const label = (key: string) => translate(dictionary, key);
  const permissions: string[] = [];
  for (const [capability, key] of Object.entries(SWITCH_LABELS) as [ToolCapability, string][]) {
    if (!input.capabilities.includes(capability)) permissions.push(label(key));
  }
  if (!input.capabilities.includes('browser.read')) permissions.push(`${label('Trình duyệt')}: ${label('Đọc trang')}`);
  else if (!input.capabilities.includes('browser.act') && !input.schedule) permissions.push(`${label('Trình duyệt')}: ${label('Đọc và thao tác')}`);
  // A schedule never uses desktop apps (COD-261, phase 2a), so it has no desktop switch to point at.
  if (input.desktopAvailable && !input.schedule) {
    if (!input.capabilities.includes('desktop.read')) permissions.push(`${label('Ứng dụng trên máy')}: ${label('Đọc cửa sổ')}`);
    else if (!input.capabilities.includes('desktop.act')) permissions.push(`${label('Ứng dụng trên máy')}: ${label('Đọc và thao tác')}`);
  }
  if (!input.workspacePermissions?.length) permissions.push(label('Thư mục làm việc'));
  else if (!input.workspacePermissions.includes('execute')) permissions.push(`${label('Thư mục làm việc')}: ${label('Đọc, sửa file và chạy lệnh')}`);
  if (!permissions.length) return null;
  // A side thread can never be wider than its main chat, so the switch that matters is the main chat's. Built from the
  // labels on screen, so it reads the same as the path the person clicks.
  const details = `${label('Chi tiết')} → ${label('Quyền công cụ')}`;
  const where = input.sideThread ? `${label('Chat chính')}: ${details}` : details;
  return { permissions, where };
}

/** Where a chat's permissions are changed, as one message value the dictionary translates whole. */
const PERMISSIONS_WHERE = 'Chi tiết → Quyền công cụ';
/** A side thread is never wider than its main chat, so the change is made there. */
const MAIN_CHAT_PERMISSIONS_WHERE = 'Chat chính: Chi tiết → Quyền công cụ';

/** The switch a capability-gated tool needs, as the controls label it; the browser and desktop levels share one name. */
const CAPABILITY_LABELS: Partial<Record<ToolCapability, string>> = {
  ...SWITCH_LABELS,
  'browser.read': 'Trình duyệt',
  'browser.act': 'Trình duyệt',
  'desktop.read': 'Ứng dụng trên máy',
  'desktop.act': 'Ứng dụng trên máy',
};

/** How many refused calls in a row end a run: a worker that keeps calling what it cannot use is stuck, not adapting. */
export const MAX_REFUSED_CALLS_IN_A_ROW = 3;

type RefusalInput = {
  problem: ToolCallProblem;
  /** The tools the run may call now. */
  offered: readonly string[];
  /** The folder levels the run froze, or undefined without a folder. */
  workspacePermissions: readonly WorkspacePermission[] | undefined;
  language: Language;
  sideThread: boolean;
};

/** The model's answer to a call it may correct, and the activity line the person reads (Vietnamese source, like every event). */
export type ToolCallRefusal = { result: Record<string, unknown>; event: string };

/**
 * What the person would change for a tool this run was not offered, as an activity line, or null when the tool is not
 * something a permission gives (a crew-only tool, another stage's tool). The line names the control and where it is.
 */
function permissionLine(problem: Extract<ToolCallProblem, { kind: 'not_offered' }>, input: RefusalInput): string | null {
  const where = input.sideThread ? MAIN_CHAT_PERMISSIONS_WHERE : PERMISSIONS_WHERE;
  if (problem.workspacePermission) {
    if (!input.workspacePermissions?.length) return `Chưa dùng được thư mục vì chat này chưa có thư mục làm việc. Chọn một thư mục ở ${where} → Thư mục làm việc, rồi gửi lại tin nhắn.`;
    if (problem.workspacePermission === 'write') return `Chưa sửa được tệp vì thư mục làm việc chỉ cho đọc. Đổi thành “Đọc và sửa file” ở ${where} → Thư mục làm việc, rồi gửi lại tin nhắn.`;
    if (problem.workspacePermission === 'execute') return `Chưa chạy được lệnh vì thư mục làm việc chưa cho chạy lệnh. Đổi thành “Đọc, sửa file và chạy lệnh” ở ${where} → Thư mục làm việc, rồi gửi lại tin nhắn.`;
    return null;
  }
  const label = problem.capability ? CAPABILITY_LABELS[problem.capability] : undefined;
  if (!label) return null;
  return `Chưa dùng được “${label}” vì quyền này đang tắt. Bật ở ${where}, rồi gửi lại tin nhắn.`;
}

/**
 * The tool's answer to a call the worker can correct (COD-289), instead of a failed run: which tools it has, and for a
 * permission the chat has off, the sentence to tell the person, in the app's language. Before this, an orglet asked
 * to edit in a folder narrowed to reading failed with "The tool is not allowed by policy." and never learned it could
 * only read.
 */
export function toolCallRefusal(input: RefusalInput): ToolCallRefusal {
  const { problem } = input;
  if (problem.kind === 'invalid_arguments') {
    return {
      result: { toolError: 'invalid_arguments', tool: problem.tool, error: `The arguments do not match ${problem.tool}.`, issues: problem.issues,
        next: 'Nothing was run. Call it again with arguments that match its schema.' },
      event: `Tham số công cụ không hợp lệ: ${problem.tool}`,
    };
  }
  const available = [...input.offered];
  if (problem.kind === 'unknown') {
    return {
      result: { toolError: 'unknown', tool: problem.tool, error: `No tool is named ${problem.tool}.`, available,
        next: 'Nothing was run. Use one of the available tools.' },
      event: `Công cụ không có trong chat này: ${problem.tool}`,
    };
  }
  const line = permissionLine(problem, input);
  if (!line) {
    return {
      result: { toolError: 'not_offered', tool: problem.tool, error: `${problem.tool} is not available here.`, available,
        next: 'Nothing was run. Do not call it again in this turn; use one of the available tools.' },
      event: `Công cụ không có trong chat này: ${problem.tool}`,
    };
  }
  const forThePerson = translateMessage(dictionaryFor(input.language), line);
  return {
    result: { toolError: 'not_offered', tool: problem.tool, error: `${problem.tool} is not allowed in this chat.`, available,
      next: `Nothing was run. Do not call it again in this turn. Do what you can with the available tools, and tell the person in one sentence what to change, in their language: ${forThePerson}` },
    event: line,
  };
}

/** How many of the latest tool results in a row were refused calls, so a worker that keeps retrying can be stopped. */
export function refusedCallsInARow(messages: readonly { role: string; content?: unknown }[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'tool') continue;
    if (typeof message.content !== 'string' || !message.content.startsWith('{"toolError":')) break;
    count++;
  }
  return count;
}
