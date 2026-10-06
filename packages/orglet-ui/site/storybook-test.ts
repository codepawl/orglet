// The site shows the stories without Storybook. Some stories import `storybook/test` to open a menu or a dialog
// in a `play` function; the real module is over half a megabyte, so the site aliases it to this stand-in, which
// covers exactly what those functions use: `fn`, `userEvent.click`, and `within(...).getByRole(role, { name })`.
type RoleQuery = { name?: string | RegExp };

const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  menuitem: '[role=menuitem]',
  combobox: '[role=combobox]',
  tab: '[role=tab]',
  textbox: 'input:not([type]), input[type=text], textarea',
  checkbox: 'input[type=checkbox]',
  radio: 'input[type=radio], [role=radio]',
  option: '[role=option]',
  dialog: 'dialog, [role=dialog]',
};

function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy.split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim();
  }
  return (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
}

function matchesName(element: Element, name: RoleQuery['name']): boolean {
  if (name === undefined) return true;
  const actual = accessibleName(element);
  return typeof name === 'string' ? actual === name : name.test(actual);
}

function getByRole(root: Element, role: string, query: RoleQuery = {}): HTMLElement {
  const selector = `[role=${role}], ${IMPLICIT_ROLES[role] ?? `[role=${role}]`}`;
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find(element => matchesName(element, query.name));
  if (!found) throw new Error(`No ${role} named ${String(query.name)}`);
  return found;
}

export function within(root: Element) {
  return {
    getByRole: (role: string, query?: RoleQuery) => getByRole(root, role, query),
    findByRole: async (role: string, query?: RoleQuery) => getByRole(root, role, query),
  };
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export const userEvent = {
  async click(element: HTMLElement): Promise<void> {
    element.focus();
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.click();
    await nextFrame();
  },
  async hover(element: HTMLElement): Promise<void> {
    element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await nextFrame();
  },
  async tab(): Promise<void> {
    await nextFrame();
  },
  async keyboard(): Promise<void> {
    await nextFrame();
  },
};

/** A callback that does nothing, where a story only needs something to pass as a handler. */
export function fn<Arguments extends unknown[]>(): (...callArguments: Arguments) => void {
  return () => undefined;
}
