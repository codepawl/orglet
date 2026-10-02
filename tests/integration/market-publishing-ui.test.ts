// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AccountState } from '../../apps/desktop/src/shared/account';
import type { PublishingResult } from '../../apps/desktop/src/shared/market-desktop';

const fixture = vi.hoisted(() => ({ listeners: new Set<(state: AccountState) => void>(), execute: vi.fn(), call: vi.fn() }));
vi.mock('../../apps/desktop/src/renderer/api', () => ({ orglet: {
  accountState: async () => ({ status: 'signed_in', email: 'fixture@example.test', name: 'Fixture publisher' }),
  onAccount: (listener: (state: AccountState) => void) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); },
  marketPublishing: fixture.execute,
  call: fixture.call,
} }));
import { MarketOwnListings, MarketPublishingDialog } from '../../apps/desktop/src/renderer/components/MarketPublishing';
import { t } from '../../apps/desktop/src/renderer/i18n';
import { Marketplace } from '../../apps/desktop/src/renderer/components/Marketplace';

let root: Root | undefined;
async function render(element: ReturnType<typeof createElement>) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  fixture.execute.mockReset();
  fixture.call.mockReset();
  fixture.listeners.clear();
});

it('returns from the next discovery page through a cached read without requiring another online refresh', async () => {
  const first = { listings: [], source: 'cache', fetchedAt: null, nextCursor: 'page-two' };
  fixture.call.mockImplementation(async (command, input) => command === 'marketInstallations' ? [] : input.cursor === 'page-two' ? { ...first, nextCursor: null, pageCursor: 'page-two', source: 'online' } : first);
  await render(createElement(Marketplace, { onAdded: () => {} }));
  const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.includes(t(label)))!;
  expect(button('Trang trước').disabled).toBe(true);
  await act(async () => button('Trang tiếp theo').click());
  expect(button('Trang trước').disabled).toBe(false);
  expect(button('Trang tiếp theo').disabled).toBe(true);
  await act(async () => button('Trang trước').click());
  expect(fixture.call.mock.calls.at(-1)).toEqual(['marketCatalog', { cursor: undefined }]);
  expect(button('Trang trước').disabled).toBe(true);
  expect(button('Trang tiếp theo').disabled).toBe(false);
});

it('keeps discovery navigation disabled until the initial delayed refresh finishes', async () => {
  let complete!: (value: unknown) => void;
  const first = { listings: [], source: 'cache', fetchedAt: null, nextCursor: 'page-two' };
  fixture.call.mockImplementation(async (command, input) => command === 'marketInstallations' ? [] : input.refresh ? new Promise(resolve => { complete = resolve; }) : first);
  await render(createElement(Marketplace, { onAdded: () => {} }));
  const next = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(t('Trang tiếp theo')))!;
  expect(next.disabled).toBe(true);
  const before = fixture.call.mock.calls.length;
  await act(async () => next.click());
  expect(fixture.call.mock.calls).toHaveLength(before);
  await act(async () => complete({ ...first, source: 'online' }));
  expect(next.disabled).toBe(false);
});

it('opens a retained recent page after an offline restart even when the intervening page was evicted', async () => {
  const first = { listings: [], source: 'cache', fetchedAt: null, nextCursor: '2', cachedPages: Array.from({ length: 9 }, (_, index) => ({ cursor: String(index + 4), name: `Recent ${index + 4}` })) };
  fixture.call.mockImplementation(async (command, input) => command === 'marketInstallations' ? [] : { ...first, ...(input.cursor ? { pageCursor: input.cursor } : {}) });
  await render(createElement(Marketplace, { onAdded: () => {} }));
  await act(async () => document.querySelector<HTMLElement>('[role=combobox]')!.click());
  const last = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent?.includes('Recent 12'))!;
  expect(last).toBeDefined();
  await act(async () => last.click());
  expect(fixture.call.mock.calls.at(-1)).toEqual(['marketCatalog', { cursor: '12' }]);
  expect(document.querySelector('[role=combobox]')?.textContent).toContain('Recent 12');
});

it('opens the required public connection choice for a private connection before preview', async () => {
  await render(createElement(MarketPublishingDialog, { source: { kind: 'orglet', entityId: 'c6639dce-1304-4f39-9b7d-a9d3b9f5aa60', name: 'Private source' }, sourceRevision: '1', requiresSuggestion: true, onClose: () => {} }));
  const options = document.querySelector<HTMLDetailsElement>('details')!;
  expect(options.open).toBe(true);
  expect(options.textContent).toContain(t('Kết nối riêng không được chia sẻ. Chọn một kết nối gợi ý trong mục phiên bản và model trước khi xem trước.'));
  const summary = document.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(summary, 'A public description');
    summary.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const preview = [...document.querySelectorAll('button')].find(button => button.textContent?.includes(t('Xem trước nội dung công khai')))!;
  expect(preview.disabled).toBe(true);
  const choice = options.querySelector<HTMLElement>('[role=combobox]')!;
  await act(async () => choice.click());
  const provider = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(option => option.textContent === 'OpenAI')!;
  expect(provider).toBeDefined();
  await act(async () => provider.click());
  expect(preview.disabled).toBe(false);
  expect(fixture.execute).not.toHaveBeenCalled();
});

it('keeps owner reads and inspection available while a closed write gate disables withdrawal and retry', async () => {
  const listing = { listingId: 'fixture-owned', kind: 'orglet' as const, version: 1, name: 'Owned public listing', summary: 'Fixture', tags: [], language: 'en' as const, license: 'CC-BY-4.0' as const, changelog: '', author: { displayName: 'Fixture' }, sha256: 'a'.repeat(64), reviewDigest: 'b'.repeat(64) };
  const operation = { id: 'c6639dce-1304-4f39-9b7d-a9d3b9f5aa60', name: 'Uncertain withdrawal', operation: 'unpublish' as const, target: listing.listingId, state: 'unknown' as const };
  fixture.execute.mockImplementation(async action => action.action === 'inspect' ? { kind: 'saved', operation, requestText: '{}' } : { kind: 'own', view: {
    capability: { status: 'unavailable' }, confirmations: {}, operations: [operation],
    summaries: { publishingEnabled: false, listings: [{ listingId: listing.listingId, kind: 'orglet', publicationEpoch: 0, published: listing, latest: { listing, state: 'approved' } }], allowance: { listingCount: 1, listingLimit: 10, submissionLimit: 5, submissionsInHour: 0 } },
  } });
  await render(createElement(MarketOwnListings));
  const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent?.includes(t(label)))!;
  await act(async () => button('Làm mới mục của tôi').click());
  expect(document.body.textContent).toContain(listing.name);
  expect(button('Ngừng xuất bản').disabled).toBe(true);
  expect(button('Xem nội dung đã gửi').disabled).toBe(false);
  await act(async () => button('Xem nội dung đã gửi').click());
  expect(button('Thử lại nội dung đã gửi').disabled).toBe(true);
  expect(document.querySelector('[role=dialog]')?.textContent).toContain(t('Dịch vụ xuất bản chưa sẵn sàng. Nội dung trên máy vẫn giữ nguyên.'));
  expect(fixture.execute.mock.calls.map(([action]) => action.action)).toEqual(['listOwn', 'inspect']);
});

it.each([
  { surface: 'owner', changed: true }, { surface: 'dialog', changed: true },
  { surface: 'owner', changed: false }, { surface: 'dialog', changed: false },
])('fences owner results in $surface when account changed=$changed', async ({ surface, changed }) => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let complete!: (value: PublishingResult) => void;
  fixture.execute.mockImplementation(() => new Promise<PublishingResult>(resolve => { complete = resolve; }));
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(surface === 'owner' ? createElement(MarketOwnListings) : createElement(MarketPublishingDialog, { source: { kind: 'orglet', entityId: 'c6639dce-1304-4f39-9b7d-a9d3b9f5aa60', name: 'Local worker' }, sourceRevision: '1', onClose: () => {} })));
  const refresh = [...document.querySelectorAll('button')].find(button => /Làm mới mục của tôi|Refresh my listings/.test(button.textContent ?? ''))!;
  await act(async () => refresh.click());
  await act(async () => { for (const listener of fixture.listeners) listener(changed ? { status: 'local' } : { status: 'signed_in', email: 'fixture@example.test', name: 'Fixture publisher' }); });
  await act(async () => complete({ kind: 'own', view: {
    capability: { status: 'available' }, confirmations: {},
    operations: [{ id: 'c6639dce-1304-4f39-9b7d-a9d3b9f5aa60', name: 'Previous account private listing', operation: 'create', target: null, state: 'unknown' }],
    summaries: { publishingEnabled: true, listings: [{ listingId: 'private-fixture', kind: 'orglet', publicationEpoch: 0, published: null, latest: { state: 'pending', listing: {
      listingId: 'private-fixture', kind: 'orglet', version: 1, name: 'Previous account private listing', summary: 'Fixture', tags: [], language: 'en', license: 'CC-BY-4.0', changelog: '', author: { displayName: 'Fixture' }, sha256: 'a'.repeat(64), reviewDigest: 'b'.repeat(64),
    } } }], allowance: { listingCount: 1, listingLimit: 10, submissionLimit: 5, submissionsInHour: 0 } },
  } }));
  if (surface === 'dialog') {
    const target = [...document.querySelectorAll<HTMLElement>('[role=combobox]')].at(-1)!;
    await act(async () => target.click());
  }
  if (changed) expect(document.body.textContent).not.toContain('Previous account private listing');
  else expect(document.body.textContent).toContain('Previous account private listing');
  expect(refresh.disabled).toBe(false);
});
