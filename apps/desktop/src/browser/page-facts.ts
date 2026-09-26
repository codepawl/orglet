/**
 * What the browser host reads from a page before a step on it (COD-261, phase 2). These functions run inside the page
 * through Playwright's `evaluate`, so each one stands alone: no imports, no closures. They only read; the core decides
 * what the facts mean (`core/tools/browser-risk.ts`).
 */

export type ElementFacts = {
  tag: string;
  inputType: string | null;
  autocomplete: string | null;
  fieldName: string | null;
  editable: boolean;
  submits: boolean;
  form: { method: 'get' | 'post' | 'dialog'; hasPassword: boolean; submitName: string | null } | null;
  link: { href: string; download: boolean } | null;
  inCaptcha: boolean;
};

export type FrameFacts = { passwordField: boolean; cardField: boolean; captcha: boolean };

/** Facts about one element: what it is, the form it belongs to, the link it sits in, and whether it is in a CAPTCHA. */
export function readElementFacts(element: Element): ElementFacts {
  const tag = element.tagName.toLowerCase();
  const input = tag === 'input' ? element as HTMLInputElement : null;
  const inputType = input ? (input.type || 'text').toLowerCase() : null;
  const notTyped = ['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'hidden', 'range', 'color'];
  const editable = (element as HTMLElement).isContentEditable || tag === 'textarea' || (input !== null && !notTyped.includes(inputType ?? ''));
  const owner = (element as HTMLInputElement).form ?? element.closest('form');
  const button = tag === 'button' ? element as HTMLButtonElement : null;
  const submits = owner !== null && ((button !== null && button.type === 'submit') || (inputType === 'submit' || inputType === 'image'));
  let form: ElementFacts['form'] = null;
  if (owner) {
    const override = submits ? element.getAttribute('formmethod') : null;
    const method = (override || owner.getAttribute('method') || 'get').toLowerCase();
    const submitter = owner.querySelector('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]');
    const submitText = submitter
      ? (submitter.getAttribute('aria-label') || submitter.textContent || (submitter as HTMLInputElement).value || '').trim()
      : '';
    form = {
      method: method === 'post' ? 'post' : method === 'dialog' ? 'dialog' : 'get',
      hasPassword: owner.querySelector('input[type="password"]') !== null,
      submitName: submitText ? submitText.slice(0, 300) : null,
    };
  }
  const anchor = element.closest('a[href]') as HTMLAnchorElement | null;
  const link = anchor ? { href: anchor.href.slice(0, 2000), download: anchor.hasAttribute('download') } : null;
  const captchaSelector = '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], [class*="captcha" i], [id*="captcha" i]';
  const inCaptcha = element.closest(captchaSelector) !== null || /captcha|challenges\.cloudflare\.com/i.test(location.href);
  const fieldName = [element.getAttribute('name'), element.id].filter(Boolean).join(' ').slice(0, 300);
  return {
    tag,
    inputType,
    autocomplete: element.getAttribute('autocomplete')?.slice(0, 200) ?? null,
    fieldName: fieldName || null,
    editable,
    submits,
    form,
    link,
    inCaptcha,
  };
}

/** Signs of a password, payment or CAPTCHA page in one frame; only fields someone can see count. */
export function readFrameFacts(): FrameFacts {
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const passwordField = Array.from(document.querySelectorAll('input[type="password"]')).some(visible);
  const cardField = Array.from(document.querySelectorAll('input[autocomplete*="cc-"]')).some(visible);
  const captchaSelector = '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]';
  const captcha = document.querySelector(captchaSelector) !== null;
  return { passwordField, cardField, captcha };
}

/** Frames a CAPTCHA widget or a payment provider serves. */
export const CAPTCHA_FRAME = /(?:google\.com|recaptcha\.net)\/recaptcha|hcaptcha\.com|challenges\.cloudflare\.com/i;
export const PAYMENT_FRAME = /^https:\/\/(?:[a-z0-9-]+\.)*(?:stripe\.com|paypal\.com|braintreegateway\.com|adyen\.com|checkout\.com|squareup\.com|klarna\.com|vnpay\.vn|momo\.vn|zalopay\.vn)\//i;
/** Addresses of a checkout or payment step. */
export const PAYMENT_PATH = /(?:^|[/_-])(?:checkout|payment|payments|pay|billing|thanh-toan|thanhtoan)(?:$|[/_.-])/i;
