import type { ReactNode } from 'react';
import { cn } from '../cn';
import './PanelHeading.css';

/**
 * A section's title with its description directly beneath on the left, and the section's own actions (create, import,
 * export) on the right, vertically centred. The description wraps before the actions do.
 */
export function PanelHeading({ title, description, level = 2, className, children }: {
  title: ReactNode;
  description?: ReactNode;
  /** The heading level, so the section sits correctly in the page's outline. */
  level?: 2 | 3;
  className?: string;
  /** The section's actions. */
  children?: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return <div className={cn('org-panel-heading', className)}>
    <div className="org-panel-heading-text">
      <Heading>{title}</Heading>
      {description && <p className="org-panel-heading-description">{description}</p>}
    </div>
    {children && <div className="org-panel-heading-actions">{children}</div>}
  </div>;
}
