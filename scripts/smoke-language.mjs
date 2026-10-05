import './sample-replies.mjs';
// Orglet starts in English. The smokes were written against the Vietnamese interface, so each switches the fresh
// workspace to Vietnamese first and then waits for the empty worker chat. Returns the language it started in.
export async function useVietnamese(page) {
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.locator('.welcome, .main-pane').first().waitFor();
  const initial = await page.evaluate(async () => {
    const workspace = await window.orglet.call('workspace', {});
    if (workspace.language !== 'vi') await window.orglet.call('settings', { language: 'vi', theme: workspace.theme, connectionLimitMicros: workspace.connectionLimitMicros });
    return workspace.language;
  });
  await page.getByRole('textbox', { name: 'Tin nhắn' }).waitFor();
  await useFullSidebar(page);
  return initial;
}

/**
 * A new profile starts on the rail (COD-340), and the smokes were written against the full sidebar, with its section
 * menus and row actions, so each opens it once. A wide window remembers that for the rest of the run, restarts
 * included; a narrow one would only lay it over the chat, so there it stays folded.
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
  if (!await page.locator('.app.sidebar-hidden').count()) return false;
  const active = page.locator('.area-tile.active');
  await (await active.count() ? active : page.locator('.area-tile')).first().click();
  await page.locator('.app:not(.sidebar-hidden)').waitFor();
  return true;
}

/**
 * The area rail (COD-366) picks what the sidebar lists: Home has the orglets, and each space has a tile of its own.
 * A channel made outside every space, as a template's crew is, is put into the space kept for such channels, named
 * Kênh or Channels after the language the window had then. A smoke that works with those channels opens that
 * space; with no such channel yet there is no tile, and Home is opened instead.
 */
export async function openChannels(page) {
  const tile = page.locator('.area-tile[data-name="Kênh"], .area-tile[data-name="Channels"]').first();
  try {
    await tile.waitFor({ timeout: 5000 });
  } catch {
    await openHome(page);
    return;
  }
  if (!await tile.evaluate(element => element.classList.contains('active'))) await tile.click();
}

export async function openHome(page) {
  const home = page.locator('.area-tile[data-name="Trò chuyện"], .area-tile[data-name="Chat"]').first();
  // On Home already there is nothing to do; a click would only go back to the DM that is open.
  if (!await home.evaluate(element => element.classList.contains('active'))) await home.click();
}

/** Open a specific under-the-hood task by its brief via search (sidebar no longer lists task rows). */
export async function openThreadByBrief(page, brief) {
  await expandSidebar(page);
  // Home has its search box ("Find or start a chat"); the other areas have the magnifier in the sidebar's head (COD-366).
  await page.getByRole('button', { name: /Tìm cuộc trò chuyện|Tìm hoặc bắt đầu trò chuyện/ }).first().click();
  await page.getByRole('combobox', { name: 'Tìm cuộc trò chuyện' }).fill(brief);
  await page.getByRole('option').filter({ hasText: brief }).first().click();
}

/**
 * Archive the open thread so the next send find-or-creates a fresh live row for that worker or team. Waits until the
 * thread has actually closed: the archived chat's own composer also has "Thêm nguồn" until the archive lands, and a
 * file attached there in that gap is dropped with that composer (the desktop smoke's intermittent "dataset.csv" and
 * "first.txt" timeouts). The "Đang nhắn với …" heading only renders on the fresh chat that replaces it.
 */
export async function archiveCurrentChat(page) {
  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Lưu trữ', exact: true }).click();
  await page.getByRole('heading', { name: /^Đang nhắn với / }).waitFor();
  await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).waitFor();
}

/**
 * Settings opens from the person's panel at the bottom left: the panel is a menu, and Settings is one of its items.
 */
export async function openSettings(page) {
  await page.locator('.user-panel-who').click();
  await page.getByRole('menuitem', { name: /^(Cài đặt|Settings)$/ }).click();
}
