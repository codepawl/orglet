import { canonicalMarketContent } from './market-publishing';

/** Optional properties must hash exactly as they survive the JSON transport and SQLite restart. */
export function canonicalSyncData(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Nội dung đồng bộ không hợp lệ.');
  return canonicalMarketContent(JSON.parse(serialized));
}
