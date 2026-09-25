import { useState } from 'react';
import type { Skill } from '../../shared/contracts';
import { Button, FieldLabel } from './ui';
import { Sparkles, FileText } from 'lucide-react';
import { SkillReview } from './SkillReview';
import { t } from '../i18n';
import { orglet } from '../api';
import { Input, Textarea } from '@codepawl/orglet-ui';

export function SkillEditor({ skill, done }: { skill?: Skill; done: () => void }) {
  return skill?.package ? <SkillReview skill={skill} done={done} /> : <PlainSkillEditor skill={skill} done={done} />;
}
function PlainSkillEditor({ skill, done }: { skill?: Skill; done: () => void }) {
  const [name, setName] = useState(skill?.name ?? ''); const [content, setContent] = useState(skill?.content ?? '');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <form className="form floating-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await orglet.call('saveSkill', { ...(skill ? { id: skill.id } : {}), name, content }); done(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>
    <div className="floating-form-fields">
      <label><FieldLabel icon={Sparkles} required>{t('Tên skill')}</FieldLabel><Input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
      <label><FieldLabel icon={FileText} required>{t('Nội dung')}</FieldLabel><Textarea rows={16} value={content} onChange={e => setContent(e.target.value)} required maxLength={16000} /></label>
      <p className="muted">{t('Skill chỉ chứa hướng dẫn. Nội dung không cấp quyền chạy script hay mở thêm tệp.')}</p>
    </div>
    <div className="actions floating-actions">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <Button variant="primary" disabled={busy}>{busy ? t('Đang lưu…') : t('Lưu skill')}</Button>
      {skill && <Button type="button" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await orglet.exportSkill(skill.id); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>{t('Xuất skill đã lưu')}</Button>}
    </div>
  </form>;
}
