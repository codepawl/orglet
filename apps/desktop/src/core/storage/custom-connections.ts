import { z } from 'zod';
import type { Store } from './database';
import type { Worker } from '../../shared/contracts';
import {
  checkBaseUrl,
  CustomConnection,
  customProviderId,
  findCustomConnection,
  MAX_CUSTOM_CONNECTIONS,
  type CustomConnectionInput,
} from '../../shared/custom-connections';

/** Settings key for the list; it is backed up and survives a full erase, like the keys beside it. */
export const CUSTOM_CONNECTIONS_SETTING = 'customConnections';

const StoredConnections = z.array(CustomConnection).max(MAX_CUSTOM_CONNECTIONS);

/** The saved connections. A row that no longer parses is dropped rather than shown half-valid. */
export function readCustomConnections(store: Store): CustomConnection[] {
  const raw = store.setting<unknown>(CUSTOM_CONNECTIONS_SETTING, []);
  const parsed = StoredConnections.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    const row = CustomConnection.safeParse(item);
    return row.success ? [row.data] : [];
  }).slice(0, MAX_CUSTOM_CONNECTIONS);
}

export function writeCustomConnections(store: Store, connections: CustomConnection[]) {
  store.setSetting(CUSTOM_CONNECTIONS_SETTING, StoredConnections.parse(connections));
}

/** The connection behind a `custom:<id>` provider, or an error the chat can show when it was deleted. */
export function requireCustomConnection(store: Store, provider: string): CustomConnection {
  const connection = findCustomConnection(readCustomConnections(store), provider);
  if (!connection) throw new Error('Kết nối tùy chỉnh này không còn. Chọn lại model cho Tí trong menu Chỉnh sửa.');
  return connection;
}

/** Creates a connection or renames and re-points one. The name must be unique so pickers can tell them apart. */
export function saveCustomConnection(store: Store, input: CustomConnectionInput, newId: () => string): CustomConnection {
  const checked = checkBaseUrl(input.baseUrl);
  if (!checked.ok) throw new Error(checked.error);
  const connections = readCustomConnections(store);
  const existing = input.id ? connections.find(connection => connection.id === input.id) : undefined;
  if (input.id && !existing) throw new Error('Không tìm thấy kết nối này.');
  const name = input.name.trim();
  const clash = connections.find(connection => connection.id !== input.id && connection.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new Error(`Đã có kết nối tên ${clash.name}. Đặt tên khác.`);
  if (!existing && connections.length >= MAX_CUSTOM_CONNECTIONS) throw new Error(`Tối đa ${MAX_CUSTOM_CONNECTIONS} kết nối tùy chỉnh.`);
  // Left out, the price stays as it was; null clears it, so a local server is free again and a remote one unknown.
  const price = input.price === undefined ? existing?.price : input.price ?? undefined;
  const saved: CustomConnection = { id: existing?.id ?? newId(), name, baseUrl: checked.url, ...(price ? { price } : {}) };
  const next = existing
    ? connections.map(connection => connection.id === existing.id ? saved : connection)
    : [...connections, saved];
  writeCustomConnections(store, next);
  return saved;
}

/** Removes a connection no live orglet uses. The caller drops its key and cached model list. */
export function deleteCustomConnection(store: Store, connectionId: string, liveWorkers: readonly Worker[]) {
  const connections = readCustomConnections(store);
  if (!connections.some(connection => connection.id === connectionId)) throw new Error('Không tìm thấy kết nối này.');
  const provider = customProviderId(connectionId);
  const users = liveWorkers.filter(worker => worker.provider === provider).map(worker => worker.name);
  if (users.length) throw new Error(`Kết nối này đang được dùng bởi: ${users.join(', ')}. Đổi model của các Tí đó trước.`);
  writeCustomConnections(store, connections.filter(connection => connection.id !== connectionId));
}
