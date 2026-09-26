import { expect, it } from 'vitest';
import { permissionsOff } from '../../apps/desktop/src/core/orchestration/permission-hints';

it('names the switches that are off the way the person sees them, in their language (COD-257)', () => {
  const english = permissionsOff({ capabilities: ['source.read', 'skill.read'], workspacePermissions: undefined, language: 'en', sideThread: false });
  expect(english).toEqual({
    permissions: ['Check data', 'Read and search the web', 'Browser: Read pages', 'Working folder'],
    where: 'Details → Tool permissions',
  });
  const vietnamese = permissionsOff({ capabilities: ['source.read', 'network.web'], workspacePermissions: ['read', 'write'], language: 'vi', sideThread: false });
  expect(vietnamese?.permissions).toEqual(['Kiểm tra dữ liệu', 'Trình duyệt: Đọc trang', 'Thư mục làm việc: Đọc, sửa file và chạy lệnh']);
});

it('points a side thread at its main chat, and says nothing when everything is on', () => {
  const side = permissionsOff({ capabilities: ['source.read', 'dataset.check', 'network.web'], workspacePermissions: ['read', 'write', 'execute'], language: 'en', sideThread: true });
  expect(side).toEqual({ permissions: ['Browser: Read pages'], where: 'Main chat: Details → Tool permissions' });
  expect(permissionsOff({ capabilities: ['source.read', 'dataset.check', 'network.web', 'browser.read', 'browser.act'], workspacePermissions: ['read', 'write', 'execute'], language: 'en-GB', sideThread: false })).toBeNull();
});
