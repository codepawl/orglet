import type { DesktopActKind } from '../../shared/desktop';
import type { DesktopTargetFacts } from '../../shared/desktop-host';
import { CONSEQUENTIAL_WORDS, soundsConsequential } from './browser-risk';

/**
 * How much one step on a desktop app could change (COD-261, phase 2a), decided here from what UI Automation reports
 * about the element, never from anything the model says: the tool arguments carry no tier, and the words in a window
 * only ever make a step count as more serious. The same idea and word lists as the browser's (`browser-risk.ts`).
 *
 * `input` fills in or moves around an app and runs at once. `consequential` could send, pay, delete, save over a file
 * or close an app, and asks the person every time in a solo chat. A refusal is a step Orglet never takes, whoever
 * asks: entering text into a password field.
 */
export type DesktopVerdict =
  | { risk: 'input'; reasons: []; refused?: undefined }
  | { risk: 'consequential'; reasons: string[]; refused?: string };

export type DesktopStepToJudge = { kind: DesktopActKind; target: DesktopTargetFacts };

/** Why the core asks, as the card shows it; the window translates each one. */
export const desktopRiskReasons = {
  wording: 'Tên của nó giống một việc khó rút lại: gửi, trả tiền, xóa, lưu đè, đóng hoặc đồng ý',
  dialogDefault: 'Nút mặc định của một hộp thoại',
  dialogConfirm: 'Nút xác nhận của một hộp thoại',
  password: 'Ô mật khẩu',
};

export const REFUSED_PASSWORD_FIELD = 'Orglet không bao giờ nhập vào ô mật khẩu. Nhờ người dùng tự nhập trong ứng dụng.';

/**
 * Words that are only serious on a desktop app, on top of the browser's: saving over a file, discarding work, closing
 * or quitting an app, restarting or installing something, printing. "Replace" in an editor rewrites the document.
 */
export const DESKTOP_CONSEQUENTIAL_WORDS: readonly string[] = [
  ...CONSEQUENTIAL_WORDS,
  'save', 'save as', 'overwrite', 'replace', 'discard', 'erase', 'format', 'reset', 'restart', 'shut down', 'shutdown', 'install',
  'print', 'close', 'exit', 'quit', 'end task', 'empty', 'move to trash', 'recycle',
  'lưu', 'lưu thành', 'ghi đè', 'thay thế', 'không lưu', 'đóng', 'thoát', 'khởi động lại', 'tắt máy', 'cài đặt ứng dụng', 'in tài liệu', 'dọn sạch',
];

/** In a dialog, these confirm whatever it asks, so pressing them is as serious as the question. */
const DIALOG_CONFIRM_WORDS: readonly string[] = ['ok', 'yes', 'có', 'continue', 'tiếp tục', 'apply', 'áp dụng', 'allow', 'cho phép', 'đồng ý'];

/** Field names that say they hold a secret even where UI Automation does not mark the field as a password. */
const SECRET_FIELD_WORDS: readonly string[] = ['password', 'passcode', 'passphrase', 'pin', 'mật khẩu', 'mã pin'];

/** Steps that press something: they carry out what the element's name says. */
const PRESSING_KINDS: readonly DesktopActKind[] = ['invoke', 'toggle'];

function verdict(reasons: string[]): DesktopVerdict {
  const unique = [...new Set(reasons)];
  if (!unique.length) return { risk: 'input', reasons: [] };
  return { risk: 'consequential', reasons: unique };
}

/** The tier of one step on an element, or the reason it is never taken. */
export function classifyDesktopStep(step: DesktopStepToJudge): DesktopVerdict {
  const { target } = step;
  if (step.kind === 'set_value') {
    if (target.password || soundsConsequential(target.name, SECRET_FIELD_WORDS)) {
      return { risk: 'consequential', reasons: [desktopRiskReasons.password], refused: REFUSED_PASSWORD_FIELD };
    }
    return verdict([]);
  }
  if (!PRESSING_KINDS.includes(step.kind)) return verdict([]);
  const reasons: string[] = [];
  if (soundsConsequential(target.name, DESKTOP_CONSEQUENTIAL_WORDS)) reasons.push(desktopRiskReasons.wording);
  if (target.inDialog && target.defaultButton) reasons.push(desktopRiskReasons.dialogDefault);
  if (target.inDialog && target.controlType === 'button' && soundsConsequential(target.name, DIALOG_CONFIRM_WORDS)) reasons.push(desktopRiskReasons.dialogConfirm);
  return verdict(reasons);
}
