import './sample-replies.mjs';
import { en } from '../apps/desktop/src/shared/locales/en.ts';

/**
 * The label as the app shows it in English. Source strings in the renderer are Vietnamese, so a smoke names a label by
 * its Vietnamese source string (grep it against `t('...')`) and the English text is looked up here, with `{0}`, `{1}`
 * filled in order. A string missing from en.ts fails at once with its key instead of falling back to Vietnamese.
 */
export function label(vietnamese, values = []) {
  if (!Object.hasOwn(en, vietnamese)) throw new Error(`No English text in en.ts for the key: ${vietnamese}`);
  return values.reduce((result, value, index) => result.replace(`{${index}}`, value), en[vietnamese]);
}

/** The English text before the first placeholder, for a label whose ending is a time or a count that changes. */
export function labelBefore(vietnamese) {
  return label(vietnamese, ['\u0000']).split('\u0000')[0];
}

/** The English text after the last placeholder, for a label that begins with a count or a name that changes. */
export function labelAfter(vietnamese) {
  return label(vietnamese, ['\u0000']).split('\u0000').at(-1);
}

/** A pattern for text that begins with the label, for rows that add a count or a name after it. */
export function startsWith(vietnamese, values = []) {
  return new RegExp(`^${label(vietnamese, values).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/**
 * A count label such as "{0} thay đổi" for any count. Vietnamese has one form; English has "1 change" and "3 changes"
 * as two keys, so the pattern takes either (CI failed on a lone change after the smokes moved to English).
 */
export function countPattern(vietnamese) {
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plural = escape(label(vietnamese, ['\u0000'])).replace('\u0000', '\\d+');
  const singular = en[vietnamese.replace('{0}', '1')];
  return new RegExp(singular ? `(${plural}|${escape(singular)})` : plural);
}

// Orglet starts in English and the smokes run in it. Waits for the empty chat of the fresh workspace and opens the
// full sidebar. Returns the language the workspace started in, for the smoke that checks it.
export async function useEnglish(page) {
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.locator('.welcome, .main-pane').first().waitFor();
  const language = await page.evaluate(async () => (await window.orglet.call('workspace', {})).language);
  await page.getByRole('textbox', { name: label('Tin nhắn') }).waitFor();
  await useFullSidebar(page);
  return language;
}

/**
 * A new profile starts on the full sidebar in a window wider than 780 px and on the rail in a narrower one. The smokes
 * were written against the full sidebar, with its section menus and row actions, so each makes sure it is open. A wide
 * window remembers that for the rest of the run, restarts included; a narrow one would only lay it over the chat, so
 * there it stays folded.
 */
export async function useFullSidebar(page) {
  const wide = await page.evaluate(() => innerWidth > 780);
  if (wide) await expandSidebar(page);
}

/**
 * A folded sidebar opens from the rail (user, 2026-10-04): the tile of the area on screen opens it and goes nowhere
 * else. Answers whether it was folded.
 */
export async function expandSidebar(page) {
  if (!await page.locator('.app.sidebar-hidden').count()) {
    // A sidebar that starts open is on screen before its header is: wait for the control that folds it, so a smoke
    // never presses a row while the first paint is still settling.
    // A smoke may have switched the interface to Vietnamese, so either name is the control.
    await page.getByRole('button', { name: new RegExp('^(' + label('Thu gọn sidebar') + '|Thu gọn sidebar)$') }).first().waitFor();
    await page.locator('.app:not(.startup)').waitFor();
    return false;
  }
  // A chat deleted behind the window's back (a smoke deleting it through the core) is left on the window's next
  // refresh, and leaving it folds a narrow window's sidebar again; the tile is pressed again when that happens.
  for (let attempt = 1; ; attempt++) {
    const active = page.locator('.area-tile.active');
    await (await active.count() ? active : page.locator('.area-tile')).first().click();
    try {
      await page.locator('.app:not(.sidebar-hidden)').waitFor({ timeout: attempt < 3 ? 5_000 : 30_000 });
      return true;
    } catch (error) {
      if (attempt >= 3) throw error;
    }
  }
}

/**
 * The area rail (COD-366) picks what the sidebar lists: Home has the orglets, and each space has a tile of its own.
 * A channel made outside every space, as a template's crew is, is put into the space kept for such channels, named
 * Channels. A smoke that works with those channels opens that space; with no such channel yet there is no tile, and
 * Home is opened instead.
 */
export async function openChannels(page) {
  const tile = page.locator(`.area-tile[data-name="${label('Kênh')}"]`).first();
  try {
    await tile.waitFor({ timeout: 5000 });
  } catch {
    await openHome(page);
    return;
  }
  if (!await tile.evaluate(element => element.classList.contains('active'))) await tile.click();
}

export async function openHome(page) {
  const home = page.locator(`.area-tile[data-name="${label('Trò chuyện')}"]`).first();
  // On Home already there is nothing to do; a click would only go back to the DM that is open.
  if (!await home.evaluate(element => element.classList.contains('active'))) await home.click();
}

/**
 * How a chat named after its brief reads in a search row: the row shows the name, without the full stop that ends the
 * brief, and no longer repeats the brief as the match under it.
 */
export function briefInSearchRow(brief) {
  return brief.replace(/[.!?…]+$/u, '');
}

/** Open a specific under-the-hood task by its brief via search (sidebar no longer lists task rows). */
export async function openThreadByBrief(page, brief) {
  await expandSidebar(page);
  // Home has its search box ("Find or start a chat"); a space's head keeps room for its name and has none.
  await openHome(page);
  await page.getByRole('button', { name: label('Tìm hoặc bắt đầu trò chuyện') }).first().click();
  await page.getByRole('combobox', { name: label('Tìm cuộc trò chuyện') }).fill(brief);
  await page.getByRole('option').filter({ hasText: briefInSearchRow(brief) }).first().click();
}

/**
 * Archive the open thread so the next send find-or-creates a fresh live row for that worker or team. Waits until the
 * thread has actually closed: the archived chat's own composer also has "Thêm nguồn" until the archive lands, and a
 * file attached there in that gap is dropped with that composer (the desktop smoke's intermittent "dataset.csv" and
 * "first.txt" timeouts). The "Đang nhắn với …" heading only renders on the fresh chat that replaces it.
 */
export async function archiveCurrentChat(page) {
  await page.getByRole('button', { name: label('Tùy chọn cuộc trò chuyện'), exact: true }).click();
  await page.getByRole('menuitem', { name: label('Lưu trữ'), exact: true }).click();
  await page.getByRole('heading', { name: startsWith('Đang nhắn với {0}', ['']) }).waitFor();
  await page.getByRole('button', { name: label('Thêm nguồn'), exact: true }).waitFor();
}

/**
 * Settings opens from the person's panel at the bottom left: the panel is a menu, and Settings is one of its items.
 */
export async function openSettings(page) {
  await page.locator('.user-panel-who').click();
  // The alignment check can also measure the Vietnamese interface (--language vi), so either name opens it.
  await page.getByRole('menuitem', { name: new RegExp('^(' + label('Cài đặt') + '|Cài đặt)$') }).click();
}
