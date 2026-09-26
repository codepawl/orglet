import { useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { Select as KitSelect } from '@codepawl/orglet-ui';
import { t } from '../i18n';

export type { SelectOption } from '@codepawl/orglet-ui';

/**
 * The kit's dropdown (COD-274) with the app's placeholder, and the app's field layout when it has a visible `label`:
 * the title above the trigger names it, and clicking the title focuses it.
 */
export function Select({ label, ariaLabel, ...props }: Omit<ComponentProps<typeof KitSelect>, 'labelledBy' | 'placeholder' | 'ref'> & {
  /** Visible label above the trigger; otherwise pass ariaLabel. */
  label?: ReactNode;
}) {
  const labelId = `${useId()}-label`;
  const trigger = useRef<HTMLButtonElement>(null);
  const select = <KitSelect {...props} ref={trigger} placeholder={t('Chọn')} ariaLabel={label ? undefined : ariaLabel} labelledBy={label ? labelId : undefined} />;
  if (!label) return select;
  return <div className="field">
    <span className="field-title" id={labelId} onClick={() => trigger.current?.focus()}>{label}</span>
    {select}
  </div>;
}
