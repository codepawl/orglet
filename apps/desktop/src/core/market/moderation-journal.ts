import { z } from 'zod';
import { Store } from '../storage/database';
import { MarketModerationJournalRequest, MarketModerationWrite, MarketModerationPending } from '../../shared/market-moderation';
import { canonicalMarketContent } from '../../shared/market-publishing';

const Journal = z.array(z.object({ accountKey: z.string().min(1).max(64), request: MarketModerationWrite, wasUnknown: z.boolean() }).strict()).max(10);
const SETTING = 'marketModerationOperations';

/** Private main/core command only. No token, role, account subject, execution or automatic retry. */
export class MarketModerationJournal {
  constructor(private store: Store) {}

  execute(raw: unknown): unknown {
    const action = MarketModerationJournalRequest.parse(raw);
    return this.store.transaction(() => {
      const journal = Journal.parse(this.store.setting(SETTING, []));
      if (action.action === 'read') return MarketModerationPending.parse(journal.filter(item => item.accountKey === action.accountKey).map(item => item.request));
      const key = action.action === 'begin' ? action.request.key : action.key;
      const existing = journal.find(item => item.request.key === key);
      if (action.action === 'finish') {
        if (!existing || existing.accountKey !== action.accountKey) throw new Error('Không tìm thấy thao tác duyệt đã lưu cho tài khoản này.');
        if (action.result === 'receipt' || (action.result === 'error' && !existing.wasUnknown)) {
          this.store.setSetting(SETTING, journal.filter(item => item !== existing));
        }
        return null;
      }
      if (existing && (existing.accountKey !== action.accountKey || canonicalMarketContent(existing.request) !== canonicalMarketContent(action.request))) {
        return { ok: false, code: 'idempotency_conflict' };
      }
      if (!existing && journal.length >= 10) return { ok: false, code: 'pending_limit' };
      this.store.setSetting(SETTING, [...journal.filter(item => item !== existing), { accountKey: action.accountKey, request: action.request, wasUnknown: existing !== undefined }]);
      return { ok: true, wasUnknown: existing !== undefined };
    });
  }
}
