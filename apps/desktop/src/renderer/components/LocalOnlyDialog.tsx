import { useState } from 'react';
import type { Task, Workspace } from '../../shared/contracts';
import { orglet } from '../api';
import { t, tMessage } from '../i18n';
import { LocalOnlyControl } from './LocalOnlyControl';
import { Button, Drawer } from './ui';
import { toast } from './toast';
import { FieldError } from '@codepawlhq/orglet-ui';

/** A side thread can change its privacy without changing its inherited assignee or permissions. */
export function LocalOnlyDialog({ task, workspace, onClose }: {
  task: Task;
  workspace: Workspace;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState(Boolean(workspace.syncLocalOnly?.tasks.includes(task.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inherited = workspace.syncLocalOnly?.inheritedTasks.includes(task.id) ?? false;
  const permanent = workspace.syncLocalOnly?.permanentTasks?.includes(task.id) ?? false;
  const orgletDeleted = workspace.syncLocalOnly?.deletedOrgletTasks?.includes(task.id) ?? false;
  const readOnly = inherited || permanent || orgletDeleted;
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await orglet.call('setSyncLocalOnly', { kind: 'task', id: task.id, localOnly: checked });
      toast(t('Đã lưu chat'), 'success', task.title ?? task.brief.split('\n')[0]);
      onClose();
    } catch (failure) {
      setError(tMessage((failure as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return <Drawer open onClose={onClose} title={t('Thiết lập chat')}>
    <form className="form local-only-form" onSubmit={event => { event.preventDefault(); if (!busy && !readOnly) void save(); }}>
      <LocalOnlyControl checked={checked} onChange={setChecked} inherited={inherited} permanent={permanent} orgletDeleted={orgletDeleted} />
      {error && <FieldError>{error}</FieldError>}
      <div className="actions">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{readOnly ? t('Đóng') : t('Hủy')}</Button>
        {!readOnly && <Button type="submit" variant="primary" disabled={busy}>{t('Lưu chat')}</Button>}
      </div>
    </form>
  </Drawer>;
}
