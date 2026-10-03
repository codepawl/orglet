// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
const fixture = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../apps/desktop/src/renderer/api', () => ({ orglet: {
  accountState: async () => ({ status: 'signed_in', email: 'fixture@example.test', name: 'Fixture publisher' }),
  onAccount: () => () => {}, marketModeration: fixture.execute,
} }));
import { useMarketModeration } from '../../apps/desktop/src/renderer/components/MarketModeration';
import { t } from '../../apps/desktop/src/renderer/i18n';
let root: Root | undefined;
function Recovery() {
  const moderation = useMarketModeration();
  return createElement('div', null, moderation.recovery, createElement('button', { onClick: moderation.refresh }, 'Refresh fixture'));
}
async function mount() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container);
  root = createRoot(container); await act(async () => root!.render(createElement(Recovery)));
}
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); fixture.execute.mockReset(); });
const operation = {action:'report',key:'20000000-0000-4000-8000-000000000001',input:{listingId:'fixture-listing',version:1,sha256:'a'.repeat(64),reviewDigest:'b'.repeat(64),reason:'other',explanation:'Inspect the public text.'}};
it('keeps known unresolved actions visible after a failed journal read and offers explicit recovery', async () => {
  let failing = false;
  fixture.execute.mockImplementation(async action => action.action === 'capability' ? {kind:'capability',status:'available',capability:{canReview:false,canReport:true,canWrite:true}} : failing ? {kind:'error',code:'moderation_unavailable'} : {kind:'journal',operations:[operation]});
  await mount(); expect(document.querySelector('.market-moderation-pending')).not.toBeNull();
  failing = true; await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Refresh fixture')!.click());
  expect(document.querySelector('.market-moderation-pending')).not.toBeNull();
  expect(document.body.textContent).toContain(t('Không đọc được thao tác đã lưu. Thử lại để kiểm tra kết quả.'));
  failing = false; await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === t('Thử lại'))!.click());
  expect(document.querySelector('[role=status]')).toBeNull(); expect(document.querySelector('.market-moderation-pending')).not.toBeNull();
});
it('shows a retry after an initial journal failure without claiming that no actions exist', async () => {
  fixture.execute.mockImplementation(async action => action.action === 'capability' ? {kind:'capability',status:'available',capability:{canReview:false,canReport:true,canWrite:true}} : {kind:'error',code:'moderation_unavailable'});
  await mount(); expect(document.querySelector('.market-moderation-pending')).toBeNull();
  expect(document.body.textContent).toContain(t('Không đọc được thao tác đã lưu. Thử lại để kiểm tra kết quả.'));
  fixture.execute.mockResolvedValue({kind:'journal',operations:[operation]});
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === t('Thử lại'))!.click());
  expect(document.querySelector('.market-moderation-pending')).not.toBeNull();
});
