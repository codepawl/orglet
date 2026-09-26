import type { BrowserKey } from '../../shared/browser';
import type { BrowserPageFacts, BrowserTargetFacts } from '../../shared/browser-host';

/**
 * How much one step on a page could change (COD-261, phase 2), decided here from what the page reports about the
 * element and the page, never from anything the model says: the tool arguments carry no tier, and the words on a page
 * only ever make a step count as more serious, never less.
 *
 * `input` fills in or moves around a page and runs at once. `consequential` could send, pay, buy, delete or sign
 * something away, and asks the person every time in a solo chat. A refusal is a step Orglet never takes, whoever
 * asks: typing a password, a card number, or anything on a page with a CAPTCHA.
 */
export type BrowserVerdict =
  | { risk: 'input'; reasons: []; refused?: undefined }
  | { risk: 'consequential'; reasons: string[]; refused?: string };

export type BrowserStepToJudge =
  | { kind: 'click'; target: BrowserTargetFacts; page: BrowserPageFacts }
  | { kind: 'type'; target: BrowserTargetFacts; submit: boolean; page: BrowserPageFacts }
  | { kind: 'select'; target: BrowserTargetFacts; page: BrowserPageFacts }
  | { kind: 'press'; key: BrowserKey; target: BrowserTargetFacts | null; page: BrowserPageFacts };

/** Why the core asks, as the card shows it; the window translates each one. */
export const riskReasons = {
  submitsForm: 'Gửi một biểu mẫu',
  maySend: 'Có thể gửi nội dung vừa nhập',
  wording: 'Tên của nó giống một việc khó rút lại: gửi, trả tiền, mua, xóa, đăng hoặc đồng ý',
  upload: 'Mở hộp chọn tệp để tải lên',
  download: 'Tải một tệp xuống',
  passwordPage: 'Trang có ô mật khẩu',
  paymentPage: 'Trang giống trang thanh toán',
  captchaPage: 'Trang có CAPTCHA',
  unknownKey: 'Không rõ phím này sẽ làm gì trên trang',
};

export const REFUSED_PASSWORD = 'Orglet không bao giờ gõ vào ô mật khẩu. Nhờ người dùng bấm Tiếp quản và tự nhập.';
export const REFUSED_CARD = 'Orglet không bao giờ gõ vào ô thẻ thanh toán. Nhờ người dùng bấm Tiếp quản và tự nhập.';
export const REFUSED_CAPTCHA = 'Trang có CAPTCHA: Orglet không gõ gì trên trang này và không bao giờ giải CAPTCHA. Nhờ người dùng bấm Tiếp quản.';

/**
 * Words that name a step hard to take back, in English and Vietnamese. A name matches when it holds one of them as
 * whole words; see `sameWord` for how accents count.
 *
 * The second line of each language is what a button does on a site that sends it with a script instead of a form:
 * a reply, a comment or a share goes out to other people, an approval, a merge or a deploy changes shared work, and
 * accepting or agreeing signs something. Words that are just as often a page's navigation ("Archive", "Register",
 * "Apply" on a filter) are left out; a form behind them still asks when it sends.
 */
const CONSEQUENTIAL_WORDS = [
  'send', 'pay', 'buy', 'order', 'checkout', 'check out', 'purchase', 'delete', 'remove', 'post', 'publish', 'confirm',
  'subscribe', 'unsubscribe', 'transfer', 'sign out', 'signout', 'log out', 'logout', 'submit',
  'reply', 'comment', 'share', 'tweet', 'retweet', 'repost', 'invite', 'approve', 'merge', 'deploy', 'accept', 'agree',
  'book now', 'reserve', 'donate', 'revoke', 'deactivate', 'uninstall',
  'gửi', 'thanh toán', 'mua', 'đặt hàng', 'xóa', 'đăng', 'xác nhận', 'chuyển tiền',
  'trả lời', 'bình luận', 'chia sẻ', 'mời', 'phê duyệt', 'đồng ý', 'chấp nhận', 'đặt chỗ', 'đặt phòng', 'đặt vé',
  'đặt bàn', 'quyên góp', 'nạp tiền', 'rút tiền',
];

/** Words in a link's address that mean the link itself does something, since some sites sign out or delete on a plain link. */
const CONSEQUENTIAL_PATH_WORDS = ['logout', 'signout', 'delete', 'remove', 'unsubscribe', 'checkout', 'purchase', 'pay'];

/** Card fields that say what they are only in their name or id attribute. */
const CARD_FIELD_NAME = /(?:^|[^a-z])(?:card ?number|cardnumber|cc ?num(?:ber)?|ccnumber|cvv|cvc|csc|security ?code|card ?cvc|so ?the)(?:[^a-z]|$)/;

const NAVIGATION_KEYS: readonly BrowserKey[] = ['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];

/** Vietnamese tone marks; the vowel marks (circumflex, breve, horn) stay where they are. */
const TONE_MARKS = /[̣̀́̃̉]/g;

/** A lowercase word without its accents, đ as d. */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
}

/** The same word with its tone mark moved to the end, so "xoá" and "xóa" (two ways of placing the mark) compare equal. */
function withToneLast(word: string): string {
  const decomposed = word.normalize('NFD');
  const tones = decomposed.match(TONE_MARKS)?.join('') ?? '';
  return decomposed.replace(TONE_MARKS, '') + tones;
}

/**
 * Whether a word on the page is the keyword. Written without any accent ("thanh toan", "Dang bai"), it matches the
 * keyword's letters; written with accents, the accents must be the keyword's, so "mùa" (season) is not "mua" (buy) and
 * "đang" (doing) is not "đăng" (post). Placing the tone mark differently ("xoá", "xóa") is the same word.
 */
function sameWord(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  if (folded(actual) !== folded(expected)) return false;
  const writtenWithoutAccents = folded(actual) === actual;
  return writtenWithoutAccents || withToneLast(actual) === withToneLast(expected);
}

/** A name as whole lowercase words: invisible characters dropped, split on anything that is not a letter or a digit. */
function wordsOf(text: string): string[] {
  const cleaned = text.normalize('NFC').replace(/\p{Cf}/gu, '').toLowerCase();
  return cleaned.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** Whether the text holds one of the words as a run of whole words, ignoring case and accents as `sameWord` does. */
export function soundsConsequential(text: string, words: readonly string[] = CONSEQUENTIAL_WORDS): boolean {
  const actual = wordsOf(text);
  for (const phrase of words) {
    const expected = wordsOf(phrase);
    for (let start = 0; start + expected.length <= actual.length; start++) {
      if (expected.every((word, offset) => sameWord(actual[start + offset], word))) return true;
    }
  }
  return false;
}

function linkDoesSomething(href: string): boolean {
  let path: string;
  try {
    const url = new URL(href);
    path = `${url.pathname} ${url.search}`;
  } catch {
    path = href;
  }
  const words = path.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some(word => CONSEQUENTIAL_PATH_WORDS.includes(word));
}

/** What a field says about itself, which is all the password and card checks read. */
type FieldFacts = Pick<BrowserTargetFacts, 'inputType' | 'autocomplete' | 'fieldName'>;

export function isPasswordField(target: FieldFacts): boolean {
  if (target.inputType === 'password') return true;
  const tokens = (target.autocomplete ?? '').toLowerCase().split(/\s+/);
  return tokens.some(token => token === 'current-password' || token === 'new-password' || token === 'one-time-code');
}

export function isCardField(target: FieldFacts): boolean {
  const tokens = (target.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (tokens.some(token => token.startsWith('cc-'))) return true;
  const name = folded((target.fieldName ?? '').toLowerCase()).replace(/[_-]/g, ' ');
  return CARD_FIELD_NAME.test(name);
}

/** Reasons that come from the page rather than the element: a password, payment or CAPTCHA page. */
function pageReasons(page: BrowserPageFacts): string[] {
  const reasons: string[] = [];
  if (page.passwordField) reasons.push(riskReasons.passwordPage);
  if (page.cardField || page.payment) reasons.push(riskReasons.paymentPage);
  if (page.captcha) reasons.push(riskReasons.captchaPage);
  return reasons;
}

/** What clicking the element could do, from the element alone. */
function clickReasons(target: BrowserTargetFacts): string[] {
  const reasons: string[] = [];
  if (target.inputType === 'file') reasons.push(riskReasons.upload);
  if (target.link?.download) reasons.push(riskReasons.download);
  if (target.submits && target.form && (target.form.method === 'post' || target.form.hasPassword)) reasons.push(riskReasons.submitsForm);
  if (soundsConsequential(target.name) || (target.link && linkDoesSomething(target.link.href))) reasons.push(riskReasons.wording);
  return reasons;
}

/**
 * What Enter could do in the element that has focus. A search or filter form that only opens an address (GET, no
 * password) is input; a form that sends data is not; and a text box outside a form, or a text area, is where chat
 * apps send a message on Enter, so it counts as sending too.
 */
function enterReasons(target: BrowserTargetFacts | null): string[] {
  if (!target) return [];
  const activates = target.tag === 'a' || target.tag === 'button' || target.role === 'link' || target.role === 'button';
  if (activates && !target.editable) return clickReasons(target);
  if (!target.editable) return [riskReasons.unknownKey];
  const reasons: string[] = [];
  const opensAddress = target.tag === 'input' && target.form?.method === 'get' && !target.form.hasPassword;
  if (!opensAddress) reasons.push(target.form && target.tag === 'input' ? riskReasons.submitsForm : riskReasons.maySend);
  if (target.form?.submitName && soundsConsequential(target.form.submitName)) reasons.push(riskReasons.wording);
  return reasons;
}

function verdict(reasons: string[]): BrowserVerdict {
  const unique = [...new Set(reasons)];
  if (!unique.length) return { risk: 'input', reasons: [] };
  return { risk: 'consequential', reasons: unique };
}

function refusal(refused: string, reasons: string[]): BrowserVerdict {
  return { risk: 'consequential', reasons, refused };
}

/** The tier of one step on a page, or the reason it is never taken. */
export function classifyBrowserStep(step: BrowserStepToJudge): BrowserVerdict {
  const page = pageReasons(step.page);
  if (step.kind === 'click') {
    if (step.target.inCaptcha) return refusal(REFUSED_CAPTCHA, [riskReasons.captchaPage]);
    return verdict([...clickReasons(step.target), ...page]);
  }
  if (step.kind === 'type') {
    if (isPasswordField(step.target)) return refusal(REFUSED_PASSWORD, [riskReasons.passwordPage]);
    if (isCardField(step.target)) return refusal(REFUSED_CARD, [riskReasons.paymentPage]);
    if (step.page.captcha || step.target.inCaptcha) return refusal(REFUSED_CAPTCHA, [riskReasons.captchaPage]);
    const sending = step.submit ? enterReasons(step.target) : [];
    return verdict([...sending, ...page]);
  }
  if (step.kind === 'select') return verdict(page);
  if (NAVIGATION_KEYS.includes(step.key)) return verdict([]);
  if (step.key === 'Backspace') {
    if (step.target && isPasswordField(step.target)) return refusal(REFUSED_PASSWORD, [riskReasons.passwordPage]);
    if (step.target && isCardField(step.target)) return refusal(REFUSED_CARD, [riskReasons.paymentPage]);
    if (step.page.captcha) return refusal(REFUSED_CAPTCHA, [riskReasons.captchaPage]);
    return verdict(page);
  }
  if (step.target?.inCaptcha) return refusal(REFUSED_CAPTCHA, [riskReasons.captchaPage]);
  return verdict([...enterReasons(step.target), ...page]);
}
