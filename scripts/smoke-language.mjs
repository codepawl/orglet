// Orglet starts in English. The smokes were written against the Vietnamese interface, so each switches the fresh
// workspace to Vietnamese first and then waits for the Vietnamese new-task heading. Returns the language it started in.
export async function useVietnamese(page) {
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.locator('.welcome, .main-pane').first().waitFor();
  const initial = await page.evaluate(async () => {
    const workspace = await window.orglet.call('workspace', {});
    if (workspace.language !== 'vi') await window.orglet.call('settings', { language: 'vi', theme: workspace.theme, connectionLimitMicros: workspace.connectionLimitMicros });
    return workspace.language;
  });
  await page.getByRole('heading', { name: 'Bạn muốn giao việc gì?' }).waitFor();
  return initial;
}
