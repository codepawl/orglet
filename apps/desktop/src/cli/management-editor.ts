import { t } from './text';
import type { CrewPatch, ManagementCatalog, ManagementTarget, OrgletPatch } from './management';
import { displayWidth, muted, padEnd, paint, truncate, wrapSegments, type ColorMode } from './terminal';
import { renderMiniFace } from './faces';
import { normalizeRoleText } from '../shared/role-words';

export type ManagementAction = 'new' | 'edit' | 'delete' | 'menu';
type EntityKind = 'worker' | 'team';
type Choice = { key: string; label: string; detail?: string };
type Field = { key: string; label: string; hint?: string };
type EditorState = 'kind' | 'entity' | 'menu' | 'fields' | 'value' | 'confirm' | 'saving';
export type EditorResult =
  | { action: 'cancel' }
  | { action: 'save'; kind: 'worker'; config: OrgletPatch; target?: ManagementTarget }
  | { action: 'save'; kind: 'team'; config: CrewPatch; target?: ManagementTarget }
  | { action: 'delete'; kind: EntityKind; target: ManagementTarget; confirmName: string };

const ORGLET_FIELDS: Field[] = [
  { key: 'name', label: t("Tên") },
  { key: 'instructions', label: t("Hướng dẫn"), hint: t("Ctrl+J xuống dòng; Enter giữ hướng dẫn") },
  { key: 'description', label: t("Mô tả"), hint: t("Không bắt buộc · tối đa 160 ký tự") },
  { key: 'provider', label: t("Kết nối") },
  { key: 'modelId', label: t("Model"), hint: t("Gõ ID model, hoặc để trống để dùng mặc định của kết nối") },
  { key: 'skillId', label: t("Skill") },
  { key: 'taskBudgetMicros', label: t("Giới hạn mỗi việc (USD)"), hint: t("Không bắt buộc · 0.001 đến 100 · tối đa sáu chữ số thập phân") },
  { key: 'color', label: t("Màu"), hint: t("Không bắt buộc · #rrggbb") },
];
const CREW_FIELDS: Field[] = [
  { key: 'name', label: t("Tên") },
  { key: 'instructions', label: t("Hướng dẫn"), hint: t("Ctrl+J xuống dòng; Enter giữ hướng dẫn") },
  { key: 'memberIds', label: t("Thành viên") },
  { key: 'synthesizerId', label: t("Tí dẫn dắt") },
  { key: 'workflow', label: t("Cách phối hợp") },
  { key: 'monthlyBudgetMicros', label: t("Giới hạn tháng (USD)"), hint: t("0.001 đến 1000 · tối đa sáu chữ số thập phân") },
  { key: 'taskBudgetMicros', label: t("Giới hạn mỗi việc (USD)"), hint: t("Không bắt buộc · 0.001 đến 100") },
  { key: 'maxConcurrentTasks', label: t("Số chat cùng lúc"), hint: t("Không bắt buộc · số nguyên từ 1 đến 8") },
];

/** Money stays integer micros; decimal input is split rather than multiplied as a float. */
export function parseDollarLimit(text: string, maximum: number): number {
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) throw new Error(t("Nhập số tiền USD với tối đa sáu chữ số thập phân."));
  const [whole, fraction = ''] = text.split('.');
  const micros = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(micros) || micros < 1000 || micros > maximum) throw new Error(t('Dùng số tiền từ 0.001 đến {0} USD.', maximum / 1_000_000));
  return micros;
}

export class ManagementEditor {
  state: EditorState;
  kind: EntityKind | undefined;
  target: ManagementTarget | undefined;
  originalName = '';
  values: Record<string, unknown> = {};
  selected = 0;
  filter = '';
  error = '';
  field: Field | undefined;
  contextOffset = 0;

  constructor(public action: ManagementAction, readonly catalog: ManagementCatalog, kind?: EntityKind, name?: string) {
    this.kind = kind;
    this.state = action === 'new' ? kind ? 'fields' : 'kind' : 'entity';
    if (kind && action === 'new') this.initialize();
    if (name) {
      const entities = [...catalog.orglets.map(entity => ({ ...entity, kind: 'worker' as const })), ...catalog.crews.map(entity => ({ ...entity, kind: 'team' as const }))];
      const matches = entities.filter(entity => (!kind || entity.kind === kind) && entity.config.name.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (matches.length === 1) this.chooseEntity(matches[0].kind, matches[0].id);
      else {
        this.state = 'entity';
        this.filter = name;
        this.error = matches.length > 1 ? t("Nhiều mục có cùng tên. Dùng phím mũi tên để chọn.") : t("Chọn Tí hoặc hội cần quản lý.");
      }
    }
  }

  get isPicker(): boolean {
    return ['kind', 'entity', 'menu', 'fields'].includes(this.state) || (this.state === 'value' && ['provider', 'skillId', 'workflow', 'synthesizerId', 'memberIds'].includes(this.field?.key ?? ''));
  }

  get title(): string {
    const verb = { new: t("Tạo"), edit: t("Sửa"), delete: t("Xóa"), menu: t('Quản lý') }[this.action];
    return `${verb} ${this.kind === 'team' ? 'crew' : this.kind === 'worker' ? 'orglet' : 'orglet or crew'}${this.originalName ? ` · ${this.originalName}` : ''}`;
  }

  get placeholder(): string {
    if (this.state === 'confirm') return t('Gõ {0} để xóa', this.originalName);
    if (this.state === 'value') return this.field?.hint ?? this.field?.label ?? '';
    if (this.state === 'saving') return t("Đang lưu…");
    return this.state === 'fields' ? t("Chọn thiết lập, Lưu, hoặc Hủy…") : t("Tìm…");
  }

  context(width: number, mode: ColorMode): string[] {
    const icon = this.kind === 'team' ? '▦' : this.kind === 'worker' ? renderMiniFace((this.values.avatar as { color?: string } | undefined)?.color, mode) : '';
    const title = this.state === 'confirm' ? `${t('Xóa')} ${this.kind === 'team' ? 'crew' : 'orglet'}` : `${icon ? `${icon} ` : ''}${this.title}`;
    const lines = [paint(truncate(title, width), { bold: true }, mode)];
    if (this.target && this.state !== 'confirm' && this.state !== 'saving') {
      const detail = this.kind === 'worker'
        ? [this.catalog.providers.find(provider => provider.id === this.values.provider)?.name ?? String(this.values.provider), this.values.modelId ?? t('model mặc định')].join(' · ')
        : `${t('Đã chọn {0}', (this.values.memberIds as string[]).length)} · ${t('Tí dẫn dắt')}: ${this.catalog.orglets.find(entity => entity.id === this.values.synthesizerId)?.config.name ?? '—'} · ${this.values.workflow}`;
      lines.push(muted(truncate(detail, width), mode));
    }
    if (this.error && this.state !== 'confirm') lines.push(truncate(this.error, width));
    if (this.state !== 'confirm') lines.push('');
    if (this.state === 'confirm') {
      lines.push(...wrapSegments([{ text: this.originalName, style: { bold: true } }], { width, mode }));
      lines.push(truncate(t("Mục này sẽ rời danh sách đang dùng. Chat cũ vẫn đọc được."), width));
      lines.push(truncate(t("Hội, lịch đang bật và việc đang chạy có thể ngăn xóa."), width));
      if (this.error) lines.push(...wrapSegments([{ text: this.error }], { width, mode }));
    } else if (this.state === 'value' && this.field) {
      lines.push(paint(this.field.label, { bold: true }, mode));
      if (this.field.hint) lines.push(muted(truncate(this.field.hint, width), mode));
    } else if (this.state === 'fields') {
      lines.push(muted(truncate(t("Enter sửa thiết lập. Lưu tạo bản sửa mới. Esc hủy."), width), mode));
    }
    return lines;
  }

  choices(): Choice[] {
    let choices: Choice[];
    if (this.state === 'kind') choices = [{ key: 'worker', label: 'Orglet' }, { key: 'team', label: 'Crew' }, { key: 'cancel', label: t("Hủy") }];
    else if (this.state === 'menu') choices = [{ key: 'edit', label: t('Sửa cấu hình') }, { key: 'delete', label: t('Xóa') }, { key: 'cancel', label: t('Quay lại danh sách') }];
    else if (this.state === 'entity') {
      choices = [
        ...(this.kind !== 'team' ? this.catalog.orglets.map(entity => ({ key: `worker:${entity.id}`, label: this.entityName(entity, this.catalog.orglets), detail: `${entity.config.provider}${entity.config.modelId ? `/${entity.config.modelId}` : ''}` })) : []),
        ...(this.kind !== 'worker' ? this.catalog.crews.map(entity => ({ key: `team:${entity.id}`, label: this.entityName(entity, this.catalog.crews), detail: `crew · ${t('Tí dẫn dắt')}: ${this.catalog.orglets.find(orglet => orglet.id === entity.config.synthesizerId)?.config.name ?? '—'}` })) : []),
        { key: 'cancel', label: t("Hủy") },
      ];
    } else if (this.state === 'fields') choices = [...this.fields().map(field => ({ key: field.key, label: `${field.label}  ${this.valueLabel(field)}` })), { key: 'save', label: t("Lưu") }, { key: 'cancel', label: t("Hủy") }];
    else choices = this.fieldChoices();
    return choices.filter(choice => normalizeRoleText(choice.label).includes(normalizeRoleText(this.filter)));
  }

  rows(width: number, maximum: number, mode: ColorMode): string[] {
    const choices = this.choices();
    this.selected = Math.max(0, Math.min(this.selected, choices.length - 1));
    const count = Math.max(0, maximum - 1);
    const start = Math.max(0, this.selected - Math.max(0, count - 1));
    const nameWidth = Math.min(Math.max(0, ...choices.map(choice => displayWidth(choice.label))), Math.max(4, Math.floor(width / 2) - 5));
    const rows = choices.slice(start, start + count).map((choice, index) => {
      const workerId = choice.key.startsWith('worker:') ? choice.key.slice(7) : ['memberIds', 'synthesizerId'].includes(this.field?.key ?? '') ? choice.key : undefined;
      const orglet = workerId ? this.catalog.orglets.find(entity => entity.id === workerId) : undefined;
      const icon = orglet ? `${renderMiniFace(orglet.config.avatar?.color, mode)} ` : choice.key.startsWith('team:') ? '▦ ' : '';
      const label = choice.detail ? `${padEnd(truncate(choice.label, nameWidth), nameWidth)}  ${muted(choice.detail, mode)}` : choice.label;
      return paint(truncate(`${start + index === this.selected ? '›' : ' '} ${icon}${label}`, width), { bold: start + index === this.selected }, mode);
    });
    if (maximum > 0) rows.push(muted(truncate(choices.length ? t("↑↓ di chuyển · Enter chọn · Esc quay lại/hủy") : t("Không có mục khớp · Esc quay lại"), width), mode));
    return rows;
  }

  change(text: string): void {
    if (!this.isPicker) return;
    this.filter = text;
    this.selected = 0;
  }

  navigate(direction: number): void {
    const count = this.choices().length;
    if (count) this.selected = (this.selected + direction + count) % count;
  }

  escape(): boolean {
    if (this.state === 'saving') return false;
    if (this.state === 'value') {
      this.state = 'fields';
      this.filter = '';
      this.selected = this.fields().findIndex(field => field.key === this.field?.key);
      this.field = undefined;
      this.error = '';
      return false;
    }
    return true;
  }

  submit(text: string): EditorResult | undefined {
    this.error = '';
    this.contextOffset = 0;
    if (this.state === 'saving') return;
    if (this.isPicker && text && text !== this.filter) this.change(text);
    if (this.state === 'confirm') {
      if (text !== this.originalName) {
        this.error = t("Tên phải khớp hoàn toàn. Esc hủy.");
        return;
      }
      return { action: 'delete', kind: this.kind!, target: this.target!, confirmName: text };
    }
    const choice = this.isPicker ? this.choices()[this.selected] : undefined;
    if (this.isPicker && !choice) {
      this.error = t("Không có mục khớp. Xóa tìm kiếm hoặc nhấn Esc.");
      return;
    }
    if (choice?.key === 'cancel') return { action: 'cancel' };
    if (this.state === 'menu' && choice) {
      this.action = choice.key === 'edit' ? 'edit' : 'delete';
      this.state = this.action === 'edit' ? 'fields' : 'confirm';
    } else if (this.state === 'kind' && choice) {
      this.kind = choice.key as EntityKind;
      this.state = this.action === 'new' ? 'fields' : 'entity';
      if (this.action === 'new') this.initialize();
    } else if (this.state === 'entity' && choice) {
      const [kind, id] = choice.key.split(':');
      this.chooseEntity(kind as EntityKind, id);
    } else if (this.state === 'fields' && choice) {
      if (choice.key === 'save') return this.kind === 'worker'
        ? { action: 'save', kind: 'worker', config: this.values as OrgletPatch, target: this.target }
        : { action: 'save', kind: 'team', config: this.values as CrewPatch, target: this.target };
      this.field = this.fields().find(field => field.key === choice.key);
      this.state = 'value';
    } else if (this.state === 'value' && this.field) {
      if (this.field.key === 'memberIds' && choice && choice.key !== 'done') {
        const members = this.values.memberIds as string[];
        if (!members.includes(choice.key) && members.length >= 8) this.error = t("Một hội có tối đa tám thành viên.");
        else this.values.memberIds = members.includes(choice.key) ? members.filter(id => id !== choice.key) : [...members, choice.key];
        this.filter = '';
        return;
      }
      try {
        if (choice && this.field.key !== 'memberIds') {
          const previous = this.values[this.field.key];
          this.values[this.field.key] = choice.key;
          // Show the changed connection's default in the form; the server also applies this rule to JSON patches.
          if (this.field.key === 'provider' && previous !== choice.key) this.values.modelId = null;
        } else if (!choice) this.setTextValue(text);
        this.state = 'fields';
        this.field = undefined;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return;
      }
    }
    this.filter = '';
    this.selected = 0;
    if (this.state === 'value' && this.field && this.field.key !== 'memberIds') {
      this.selected = Math.max(0, this.choices().findIndex(candidate => candidate.key === this.values[this.field!.key]));
    }
  }

  draft(): string {
    if (this.state !== 'value' || this.isPicker || !this.field) return '';
    const value = this.field.key === 'color' ? (this.values.avatar as { color?: string } | undefined)?.color : this.values[this.field.key];
    if (this.field.key.endsWith('BudgetMicros') && typeof value === 'number') return String(value / 1_000_000);
    return value === null || value === undefined ? '' : String(value);
  }

  private fields(): Field[] {
    return this.kind === 'team' ? CREW_FIELDS : ORGLET_FIELDS;
  }

  private entityName(entity: { id: string; config: { name: string } }, entries: { id: string; config: { name: string } }[]): string {
    const repeated = entries.filter(candidate => candidate.config.name.toLocaleLowerCase() === entity.config.name.toLocaleLowerCase()).length > 1;
    return repeated ? `[${entity.id.slice(-6)}] ${entity.config.name}` : entity.config.name;
  }

  private initialize(): void {
    this.values = this.kind === 'team'
      ? { name: '', instructions: '', memberIds: [], synthesizerId: this.catalog.orglets[0]?.id, workflow: 'parallel', monthlyBudgetMicros: 5_000_000 }
      : { name: '', instructions: '', provider: 'codex', skillId: this.catalog.skills[0]?.id };
  }

  private chooseEntity(kind: EntityKind, id: string): void {
    const entity = (kind === 'worker' ? this.catalog.orglets : this.catalog.crews).find(candidate => candidate.id === id)!;
    this.kind = kind;
    this.target = { id, revision: entity.revision };
    this.originalName = entity.config.name;
    this.values = structuredClone(entity.config);
    this.state = this.action === 'delete' ? 'confirm' : this.action === 'menu' ? 'menu' : 'fields';
    this.filter = '';
    this.selected = 0;
  }

  private fieldChoices(): Choice[] {
    if (this.state !== 'value' || !this.field) return [];
    if (this.field.key === 'provider') return this.catalog.providers.map(provider => ({ key: provider.id, label: provider.name }));
    if (this.field.key === 'skillId') return this.catalog.skills.map(skill => ({ key: skill.id, label: skill.name }));
    if (this.field.key === 'workflow') return [{ key: 'parallel', label: t("Song song") }, { key: 'sequential', label: t("Tuần tự") }];
    if (this.field.key === 'synthesizerId') return this.catalog.orglets.map(entity => ({ key: entity.id, label: this.entityName(entity, this.catalog.orglets) }));
    if (this.field.key === 'memberIds') return [
      ...this.catalog.orglets.map(entity => ({ key: entity.id, label: `${(this.values.memberIds as string[]).includes(entity.id) ? '[x]' : '[ ]'} ${this.entityName(entity, this.catalog.orglets)}` })),
      { key: 'done', label: t("Chọn thành viên xong") },
    ];
    return [];
  }

  private valueLabel(field: Field): string {
    const value = this.values[field.key];
    if (field.key === 'provider') return this.catalog.providers.find(provider => provider.id === value)?.name ?? String(value);
    if (field.key === 'skillId') return this.catalog.skills.find(skill => skill.id === value)?.name ?? t("Chọn skill");
    if (field.key === 'synthesizerId') return this.catalog.orglets.find(entity => entity.id === value)?.config.name ?? t("Chọn Tí dẫn dắt");
    if (field.key === 'memberIds') return t('Đã chọn {0}', (value as string[]).length);
    if (field.key === 'color') return (this.values.avatar as { color?: string } | undefined)?.color ?? t("tự động");
    if (field.key.endsWith('BudgetMicros') && typeof value === 'number') return `$${value / 1_000_000}`;
    return value === null || value === undefined || value === '' ? '—' : String(value).replace(/\s+/gu, ' ');
  }

  private setTextValue(text: string): void {
    const key = this.field!.key;
    if (key.endsWith('BudgetMicros')) {
      this.values[key] = text.trim() === '' && key !== 'monthlyBudgetMicros' ? null : parseDollarLimit(text.trim(), key === 'monthlyBudgetMicros' ? 1_000_000_000 : 100_000_000);
    } else if (key === 'maxConcurrentTasks') {
      if (text.trim() && (!/^[1-8]$/.test(text.trim()))) throw new Error(t("Dùng số nguyên từ 1 đến 8, hoặc để trống."));
      this.values[key] = text.trim() ? Number(text.trim()) : null;
    } else if (key === 'color') {
      if (text.trim() && !/^#[a-f0-9]{6}$/i.test(text.trim())) throw new Error(t("Dùng màu như #7c8be8, hoặc để trống."));
      const avatar = { ...(this.values.avatar as object | undefined) } as { color?: string | null };
      if (text.trim()) avatar.color = text.trim();
      else avatar.color = null;
      this.values.avatar = Object.keys(avatar).length ? avatar : null;
    } else {
      this.values[key] = text.trim() === '' && ['modelId', 'description'].includes(key) ? null : text.trim();
    }
  }
}
