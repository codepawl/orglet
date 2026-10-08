import { useState } from 'react';
import type { Skill } from '../../shared/contracts';
import { Button, FieldLabel } from './ui';
import { Sparkles, FileText } from 'lucide-react';
import { SkillReview } from './SkillReview';
import { t } from '../i18n';
import { orglet } from '../api';
import { Input, Textarea } from '@codepawlhq/orglet-ui';
import { isBlank, useFieldErrors } from '../fieldErrors';

export function SkillEditor({ skill, done }: { skill?: Skill; done: () => void }) {
  return skill?.package ? <SkillReview skill={skill} done={done} /> : <PlainSkillEditor skill={skill} done={done} />;
}
function PlainSkillEditor({ skill, done }: { skill?: Skill; done: () => void }) {
  const [name, setName] = useState(skill?.name ?? ''); const [content, setContent] = useState(skill?.content ?? '');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const fieldErrors = useFieldErrors('skill');
  return <form className="form floating-form" noValidate onSubmit={async e => {
    e.preventDefault(); setError('');
    const filled = fieldErrors.check(e.currentTarget, [
      { field: 'name', failed: isBlank(name), message: t('Đặt tên cho skill.') },
      { field: 'content', failed: isBlank(content), message: t('Viết hướng dẫn cho skill.') },
    ]);
    if (!filled) return;
    setBusy(true);
    try { await orglet.call('saveSkill', { ...(skill ? { id: skill.id } : {}), name, content }); done(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }}>
    <div className="floating-form-fields">
      <label><FieldLabel icon={Sparkles} required>{t('Tên skill')}</FieldLabel><Input {...fieldErrors.props('name')} value={name} onChange={e => { setName(e.target.value); fieldErrors.clear('name'); }} maxLength={80} />{fieldErrors.message('name')}</label>
      <label><FieldLabel icon={FileText} required>{t('Nội dung')}</FieldLabel><Textarea rows={16} {...fieldErrors.props('content')} value={content} onChange={e => { setContent(e.target.value); fieldErrors.clear('content'); }} maxLength={16000} />{fieldErrors.message('content')}</label>
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
