import { t } from './text';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { UsageError, type ManagementCommand } from './arguments';
import { AppRefusal } from './chat-client';
import { CrewPatch, OrgletPatch, type ManagementClient, type ManagementResult } from './management';

const MAX_CONFIG_BYTES = 64 * 1024;

async function readConfig(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_CONFIG_BYTES) throw new UsageError(t("File cấu hình phải nhỏ hơn hoặc bằng 64 KiB."));
    try {
      return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new UsageError(t("File cấu hình phải chứa một đối tượng JSON."));
    }
  } finally {
    await file.close();
  }
}

export async function runManagementCommand(command: ManagementCommand, client: ManagementClient, directory: string): Promise<ManagementResult> {
  const parsed = command.kind === 'delete' ? undefined
    : (command.entity === 'worker' ? OrgletPatch : CrewPatch).safeParse(await readConfig(resolve(directory, command.config!)));
  if (parsed && !parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.') || 'configuration'))].join(', ');
    throw new UsageError(t('Các trường cấu hình không hợp lệ: {0}. Dùng "orglet config --json" để xem cấu hình có thể sửa.', fields));
  }
  if (command.kind === 'create') return command.entity === 'worker'
    ? client.saveOrglet(OrgletPatch.parse(parsed!.data))
    : client.saveCrew(CrewPatch.parse(parsed!.data));
  const catalog = await client.catalog();
  const entities = command.entity === 'worker' ? catalog.orglets : catalog.crews;
  const matches = entities.filter(entity => entity.config.name.toLocaleLowerCase() === command.name!.toLocaleLowerCase());
  if (matches.length !== 1) throw new AppRefusal(matches.length ? t("Nhiều mục có cùng tên. Dùng /edit hoặc /delete và phím mũi tên để chọn.") : t("Không có mục nào có tên đầy đủ này. Dùng \"orglet list\"."), matches.length ? 'ambiguous' : 'not_found');
  const entity = matches[0];
  const target = { id: entity.id, revision: entity.revision };
  if (command.kind === 'delete') {
    if (command.confirm !== entity.config.name) throw new UsageError(t("--confirm phải khớp hoàn toàn với tên đầy đủ đang hiển thị."));
    return client.delete(command.entity, target, command.confirm);
  }
  return command.entity === 'worker'
    ? client.saveOrglet(OrgletPatch.parse(parsed!.data), target)
    : client.saveCrew(CrewPatch.parse(parsed!.data), target);
}
