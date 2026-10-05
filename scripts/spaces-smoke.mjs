import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';
import { useVietnamese } from './smoke-language.mjs';

// Spaces (docs/spaces-design.md) in the packaged app: make a space with a category, add a channel, send a message and
// see only the space's orglets answer, give the channel its own list, add an orglet back, then delete the space.
const directory = await mkdtemp(join(tmpdir(), 'orglet-spaces-'));
const environment = { ...process.env, ORGLET_SKIP_ACCOUNT_CHOICE: '1' };
delete environment.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env: environment });
const workspace = page => page.evaluate(() => window.orglet.call('workspace', {}));
const shot = (page, name) => page.screenshot({ path: join('test-results', `spaces-${name}.png`) });

try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 820 });
  await useVietnamese(page);
  // Three more Demo orglets, and the channel their template makes, which stays outside every space.
  await page.evaluate(() => window.orglet.call('createTemplate', { templateId: 'research-review', provider: 'demo' }));
  const orglets = (await workspace(page)).workers.map(worker => worker.name);
  assert.ok(orglets.length >= 3, 'the template added orglets');
  const [first, second, third] = orglets;

  // A new space from the rail's +, with two orglets and one category.
  await page.locator('.area-create').click();
  const spaceDialog = page.getByRole('dialog');
  await spaceDialog.getByRole('textbox', { name: 'Tên không gian' }).fill('Launch');
  await spaceDialog.getByRole('tab', { name: 'Thành viên', exact: true }).click();
  await spaceDialog.getByRole('checkbox', { name: first, exact: true }).check();
  await spaceDialog.getByRole('checkbox', { name: second, exact: true }).check();
  await spaceDialog.getByRole('tab', { name: 'Nhóm', exact: true }).click();
  await spaceDialog.getByRole('button', { name: 'Thêm nhóm', exact: true }).click();
  await spaceDialog.getByRole('textbox', { name: 'Tên nhóm' }).fill('Copy');
  // What a new channel in the space starts with: reading the web is off in the app's own defaults.
  await spaceDialog.getByRole('tab', { name: 'Quyền', exact: true }).click();
  await spaceDialog.getByRole('switch', { name: 'Đọc và tìm kiếm web' }).click();
  await shot(page, 'space-dialog');
  await spaceDialog.getByRole('button', { name: 'Tạo không gian', exact: true }).click();
  await spaceDialog.waitFor({ state: 'detached' });
  await page.locator('.area-tile.active[data-name="Launch"]').waitFor();
  assert.equal(await page.locator('.sidebar-title').textContent(), 'Launch', 'the sidebar lists the new space');
  // The space's tile is a filled mark with no letter on it, not one more icon; its name is the tile's tooltip.
  assert.equal(await page.locator('.area-tile[data-name="Launch"] > .space-mark').textContent(), '');
  assert.match(await page.locator('.area-tile[data-name="Launch"] > .space-mark').evaluate(element => getComputedStyle(element).backgroundImage), /linear-gradient/);
  // The whole tile takes the pointer, the corner its menu's wrapper lies over included.
  const missedCorners = await page.locator('.area-tile[data-name="Launch"]').evaluate(tile => {
    const box = tile.getBoundingClientRect();
    // Eight pixels in, which is inside the tile's rounded corner.
    const corners = [[box.left + 8, box.top + 8], [box.right - 8, box.top + 8], [box.left + 8, box.bottom - 8], [box.right - 8, box.bottom - 8]];
    return corners.filter(([x, y]) => !tile.contains(document.elementFromPoint(x, y))).length;
  });
  assert.equal(missedCorners, 0, 'every corner of a space tile selects it');
  // The spaces sit under a divider, below the app's own places.
  const railOrder = await page.locator('.area-rail').evaluate(rail => [...rail.children].map(child => child.className));
  assert.deepEqual(railOrder.slice(0, 3), ['area-rail-list', 'area-rail-divider', 'area-rail-list'], 'places, a divider, then spaces');
  assert.equal(await page.locator('.area-rail-divider + .area-rail-list .area-tile[data-name="Launch"]').count(), 1, 'the space is under the divider');
  // The person's face is the button: its menu opens on it and it wears a ring meanwhile, with no tile behind it.
  await page.locator('.user-panel-who').click();
  await page.locator('.org-row-menu-panel').waitFor();
  assert.equal(await page.locator('.user-panel-who').evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)', 'no tile behind the open face');
  await shot(page, 'profile-menu');
  await page.keyboard.press('Escape');
  await page.locator('.org-row-menu-panel').waitFor({ state: 'detached' });
  const made = (await workspace(page)).spaces[0];
  assert.equal(made.name, 'Launch');
  assert.equal(made.orgletIds.length, 2);
  assert.equal(made.categories[0].name, 'Copy');
  assert.deepEqual([...made.defaults.capabilities].sort(), ['dataset.check', 'network.web', 'source.read']);

  // A channel in the space takes every orglet of the space, and only they answer.
  await page.locator('.sidebar-head').getByRole('button', { name: 'Tạo trong không gian Launch', exact: true }).click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Tạo kênh', 'Tạo nhóm'], 'the space\'s + makes a channel or a category');
  await page.getByRole('menuitem', { name: 'Tạo kênh', exact: true }).click();
  const channelDialog = page.getByRole('dialog');
  await channelDialog.getByRole('textbox', { name: 'Tên kênh' }).fill('general');
  await channelDialog.getByRole('tab', { name: 'Thành viên', exact: true }).click();
  assert.equal(await channelDialog.locator('.channel-scope li').count(), 2, 'the channel shows the two orglets of its space');
  await shot(page, 'channel-dialog');
  await channelDialog.getByRole('button', { name: 'Tạo kênh', exact: true }).click();
  await channelDialog.waitFor({ state: 'detached' });
  await page.getByRole('textbox', { name: 'Tin nhắn' }).fill('Say hello in one word.');
  await page.getByRole('textbox', { name: 'Tin nhắn' }).press('Enter');
  await page.locator('.chat-reply').nth(1).waitFor();
  await page.waitForTimeout(1500);
  const row = (await workspace(page)).tasks.find(task => task.channel?.name === 'general');
  assert.equal(row.channel.spaceId, made.id);
  assert.equal(row.channel.access, 'inherit');
  assert.deepEqual(row.assignees, made.orgletIds, 'the space\'s orglets answer, in its order');
  assert.ok(row.toolCapabilities.includes('network.web'), 'the channel started with what its space sets');
  await page.locator('.members-pane').waitFor();
  assert.equal(await page.locator('.members-pane .member-item').count(), 2, 'the member column lists the two orglets');
  assert.equal(await page.locator('.members-others').count(), 0, 'a channel that takes everyone has nobody left out');
  await shot(page, 'space-channel');

  // The channel gets its own list: a lock in the sidebar, and the orglet left out is offered in the member column.
  await page.locator('.members-pane .member-item').filter({ hasText: second }).locator('.member-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Xóa khỏi kênh', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Xóa khỏi kênh', exact: true }).click();
  await page.locator('.members-others .member-item').waitFor();
  await page.locator('.sidebar .channel-hash .lucide-lock').waitFor();
  let listed = (await workspace(page)).tasks.find(task => task.channel?.name === 'general');
  assert.equal(listed.channel.access, 'listed');
  assert.equal(listed.assignees.length, 1);
  await shot(page, 'listed-channel');
  await page.locator('.members-others .member-item').first().locator('.member-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Thêm vào kênh này', exact: true }).click();
  await page.locator('.members-others').waitFor({ state: 'detached' });
  listed = (await workspace(page)).tasks.find(task => task.channel?.name === 'general');
  assert.equal(listed.assignees.length, 2, 'the orglet is back in the channel');

  // Dragging the channel onto the category moves it there.
  await page.locator('.sidebar .channel-row').first().dragTo(page.locator('.channel-drop').filter({ hasText: 'Copy' }));
  await page.waitForFunction(async categoryId => (await window.orglet.call('workspace', {})).tasks.some(task => task.channel?.name === 'general' && task.channel.categoryId === categoryId), made.categories[0].id);

  // The template's channel is outside every space, so Home lists it beside the DMs; the space's tile lists only its own.
  assert.equal(await page.locator('.sidebar .channel-row').count(), 1, 'the space lists its one channel');
  assert.equal(await page.locator('.area-tile[data-name="Kênh"]').count(), 0, 'the rail has no tile for channels');
  await page.locator('.area-tile[data-name="Trò chuyện"]').click();
  await page.locator('.sidebar .channel-row').first().waitFor();
  assert.equal(await page.locator('.sidebar-title').textContent(), 'Trò chuyện');
  assert.ok(!(await page.locator('.sidebar .channel-row').allTextContents()).some(text => text.includes('general')), 'a space\'s channel is not listed with the loose ones');
  void third;

  // Opening a channel from a DM brings its member column at once: the column does not fold in, and the main card's
  // width does not travel under the messages. The fold stays for the button that shows and hides the column.
  const rightColumnMotion = () => page.evaluate(() => document.getAnimations().map(animation => animation.animationName ?? animation.transitionProperty).filter(name => name === 'pane-in' || name === 'grid-template-columns'));
  await page.locator('.sidebar .tree-item .worker-row > button.worker').first().click();
  await page.locator('.members-pane').waitFor({ state: 'detached' });
  await page.waitForTimeout(400);
  await page.locator('.sidebar .channel-row > .worker-row > button.worker').first().click();
  await page.locator('.members-pane').waitFor();
  assert.deepEqual(await rightColumnMotion(), [], 'a chat\'s own column is in place at once');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Ẩn danh sách thành viên', exact: true }).click();
  await page.locator('.members-pane').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Hiện danh sách thành viên', exact: true }).click();
  await page.locator('.members-pane').waitFor();
  assert.ok((await rightColumnMotion()).includes('pane-in'), 'the column still folds in when the person asks for it');
  await page.waitForTimeout(300);

  // Deleting the space keeps its channel, outside every space.
  await page.locator('.area-tile[data-name="Launch"]').click();
  await page.getByRole('button', { name: 'Tùy chọn không gian Launch', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Xóa không gian', exact: true }).click();
  await shot(page, 'delete-space');
  await page.getByRole('menuitem', { name: 'Xóa không gian', exact: true }).click();
  await page.locator('.area-tile[data-name="Launch"]').waitFor({ state: 'detached' });
  const after = await workspace(page);
  assert.equal(after.spaces.length, 0);
  const kept = after.tasks.find(task => task.channel?.name === 'general');
  assert.equal(kept.channel.spaceId, undefined);
  assert.equal(kept.assignees.length, 2, 'the channel keeps the orglets it had');
  // A space from the marketplace: its orglets, its categories and its channels arrive together, and nothing else.
  // The profile has not opened the marketplace, so the catalog is the one that ships with the app.
  const orgletsBefore = after.workers.length;
  const added = await page.evaluate(() => window.orglet.call('marketAdd', { listingId: 'launch-space', version: 1 }));
  assert.equal(added.kind, 'space');
  await page.locator('.area-tile[data-name="Launch"]').click();
  await page.locator('.sidebar .channel-row').nth(2).waitFor();
  assert.equal(await page.locator('.sidebar-title').textContent(), 'Launch');
  assert.deepEqual((await page.locator('.sidebar .section-toggle').allTextContents()).map(text => text.trim()), ['Research', 'Writing']);
  assert.equal(await page.locator('.sidebar .channel-hash .lucide-lock').count(), 2, 'the two channels with their own orglets wear a lock');
  const withListing = await workspace(page);
  assert.equal(withListing.workers.length, orgletsBefore + 3);
  assert.equal(withListing.tasks.length, after.tasks.length, 'adding a space sends no message');
  await shot(page, 'market-space');

  // Publishing the space: its menu opens the form, and the preview lists every channel with its category and who is
  // in it. Nothing is sent: the smoke stops at the preview.
  await page.getByRole('button', { name: 'Tùy chọn không gian Launch', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Xuất bản lên marketplace', exact: true }).click();
  const publishing = page.locator('.market-publishing');
  await publishing.getByLabel('Tên công khai').fill('Launch space of mine');
  await publishing.getByLabel('Mô tả ngắn').fill('Three friends plan a launch.');
  await shot(page, 'publish-space-form');
  await publishing.getByRole('button', { name: /Xem trước nội dung/ }).click();
  await publishing.locator('.market-space-channels li').nth(2).waitFor();
  assert.deepEqual(await publishing.locator('.market-space-channel').allTextContents(), ['#general', '#sources', '#drafts']);
  const previewed = await publishing.locator('.market-exact-request pre').textContent();
  assert.equal(JSON.parse(previewed).kind, 'space');
  for (const worker of withListing.workers) assert.ok(!previewed.includes(worker.id), 'the preview carries no local id');
  await shot(page, 'publish-space-preview');
  await page.keyboard.press('Escape');
  await publishing.waitFor({ state: 'detached' });

  // A folder on the rail: a right click on the space's tile puts it in a new one, the folder's tile closes and opens
  // it, and removing the folder leaves the space on the rail.
  await page.locator('.area-tile[data-name="Launch"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chuyển vào thư mục mới', exact: true }).click();
  const folder = page.locator('.area-folder');
  await folder.locator('.area-tile[data-name="Launch"]').waitFor();
  assert.equal((await workspace(page)).spaces.find(space => space.name === 'Launch').folder, 'Thư mục 1');
  assert.equal(await folder.locator('.area-folder-tile').getAttribute('aria-expanded'), 'true');
  await shot(page, 'folder-open');
  await folder.locator('.area-folder-tile').click();
  await page.locator('.area-tile[data-name="Launch"]').waitFor({ state: 'detached' });
  assert.ok(await folder.locator('.area-folder-tile.active').count(), 'a closed folder marks that it holds the open space');
  await shot(page, 'folder-closed');
  await folder.locator('.area-folder-tile').click();
  await page.locator('.area-tile[data-name="Launch"]').waitFor();
  await folder.locator('.area-folder-tile').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Bỏ thư mục', exact: true }).click();
  await folder.waitFor({ state: 'detached' });
  await page.locator('.area-tile[data-name="Launch"]').waitFor();
  assert.equal((await workspace(page)).spaces.find(space => space.name === 'Launch').folder, undefined);

  // Several spaces side by side: each tile has its own fill, so they are told apart at a glance.
  const firstOrgletId = (await workspace(page)).workers[0].id;
  for (const name of ['Ra mắt', 'Khách hàng', 'Nghiên cứu']) await page.evaluate(fields => window.orglet.call('createSpace', fields), { name, orgletIds: [firstOrgletId], categories: [] });
  await page.locator('.area-tile > .space-mark').nth(3).waitFor();
  assert.deepEqual(await page.locator('.area-tile:has(> .space-mark)').evaluateAll(tiles => tiles.map(tile => tile.dataset.name)), ['Launch', 'Ra mắt', 'Khách hàng', 'Nghiên cứu']);
  // The pointer on a tile shows its name beside it, and it goes when the pointer leaves.
  await page.locator('.area-tile[data-name="Khách hàng"]').hover();
  assert.equal(await page.locator('.area-tip').textContent(), 'Khách hàng');
  const tileBox = await page.locator('.area-tile[data-name="Khách hàng"]').boundingBox();
  const tipBox = await page.locator('.area-tip').boundingBox();
  assert.ok(tipBox.x > tileBox.x + tileBox.width, 'the name sits to the right of the tile');
  assert.ok(Math.abs(tipBox.y + tipBox.height / 2 - (tileBox.y + tileBox.height / 2)) <= 1, 'the name is centred on the tile');
  await shot(page, 'tile-tip');
  await page.locator('.sidebar-title').hover();
  await page.locator('.area-tip').waitFor({ state: 'detached' });
  await shot(page, 'space-marks');
  // Dragging a category's heading onto another one moves it there, and a channel dropped on a channel's row in
  // another category takes that category and the place before that row.
  await page.locator('.area-tile[data-name="Launch"]').click();
  await page.locator('.sidebar .section-toggle').first().waitFor();
  const sectionNames = () => page.locator('.sidebar .section-toggle').evaluateAll(toggles => toggles.map(toggle => toggle.textContent.trim()).join());
  assert.equal(await sectionNames(), 'Research,Writing');
  await page.locator('.sidebar .section-toggle', { hasText: 'Research' }).dragTo(page.locator('.sidebar .section-toggle', { hasText: 'Writing' }));
  await page.waitForFunction(() => [...document.querySelectorAll('.sidebar .section-toggle')].map(toggle => toggle.textContent.trim()).join() === 'Writing,Research');
  const channelIn = async name => {
    const state = await workspace(page);
    const launch = state.spaces.find(space => space.name === 'Launch');
    const channel = [...state.tasks.map(task => task.channel), ...state.emptyChannels].find(item => item?.name === name && item.spaceId === launch.id);
    return { id: channel.id, category: launch.categories.find(category => category.id === channel.categoryId)?.name, order: state.channelOrder };
  };
  assert.equal((await channelIn('sources')).category, 'Research');
  await page.locator('.sidebar .channel-row', { hasText: 'sources' }).dragTo(page.locator('.sidebar .channel-row', { hasText: 'drafts' }));
  await page.waitForFunction(async () => {
    const state = await window.orglet.call('workspace', {});
    return state.channelOrder.length > 0;
  });
  const movedSources = await channelIn('sources');
  const drafts = await channelIn('drafts');
  assert.equal(movedSources.category, 'Writing', 'the channel took the category of the row it was dropped on');
  assert.ok(movedSources.order.indexOf(movedSources.id) < movedSources.order.indexOf(drafts.id), 'and the place before that row');
  await shot(page, 'space-dragged');
  console.log('Packaged spaces smoke passed: create a space, a channel in it, only its orglets answer with the space\'s permissions, own list and lock, add back, drag to a category, delete the space, add a space from the marketplace, preview publishing it, put it in a folder and take it out.');
} finally {
  await app.close();
}
