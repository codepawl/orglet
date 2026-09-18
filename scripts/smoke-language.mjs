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
  return initial;
}

/** Open a specific under-the-hood task by its brief via search (sidebar no longer lists task rows). */
export async function openThreadByBrief(page, brief) {
  if (await page.getByRole('button', { name: 'Mở sidebar', exact: true }).count()) {
    await page.getByRole('button', { name: 'Mở sidebar', exact: true }).click();
  }
  await page.getByRole('button', { name: /Tìm cuộc trò chuyện/ }).first().click();
  await page.getByRole('combobox', { name: 'Tìm cuộc trò chuyện' }).fill(brief);
  await page.getByRole('option').filter({ hasText: brief }).first().click();
}

/** Archive the open thread so the next send find-or-creates a fresh live row for that worker or team. */
export async function archiveCurrentChat(page) {
  await page.getByRole('button', { name: 'Tùy chọn cuộc trò chuyện', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Lưu trữ', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm nguồn', exact: true }).waitFor();
}
