import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../cn';
import './Card.css';

type CardHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
};

type StaticCardProps = Omit<ComponentProps<'section'>, 'title'> & CardHeaderProps & {
  interactive?: false;
  /** Controls on the header's right, vertically centred with the title block. */
  actions?: ReactNode;
};

type InteractiveCardProps = Omit<ComponentProps<'button'>, 'title'> & CardHeaderProps & {
  /** The whole card is one button. It cannot also hold `actions`, since a button inside a button is not allowed. */
  interactive: true;
  actions?: never;
};

function CardHeader({ titleId, title, description, actions }: CardHeaderProps & { titleId: string; actions?: ReactNode }) {
  if (!title && !description && !actions) return null;
  return <span className="org-card-header">
    <span className="org-card-heading">
      {title && <span id={titleId} className="org-card-title">{title}</span>}
      {description && <span className="org-card-description">{description}</span>}
    </span>
    {actions && <span className="org-card-actions">{actions}</span>}
  </span>;
}

/**
 * A quiet rounded surface that groups content: an optional `title` and `description` on the left of the header,
 * `actions` on its right, and the children below. There is no shadow and no line between header and body; the
 * grouping is the surface and the spacing. With `interactive` the whole card is a button that takes a hover wash and a
 * focus ring, and it names itself from its title.
 */
export function Card(props: StaticCardProps | InteractiveCardProps) {
  const titleId = useId();
  if (props.interactive) {
    const { interactive: _interactive, title, description, actions: _actions, className, children, ...button } = props;
    return <button type="button" aria-labelledby={title ? titleId : undefined} {...button} className={cn('org-card org-card-interactive', className)}>
      <CardHeader titleId={titleId} title={title} description={description} />
      {children && <span className="org-card-body">{children}</span>}
    </button>;
  }
  const { interactive: _interactive, title, description, actions, className, children, ...section } = props;
  return <section aria-labelledby={title ? titleId : undefined} {...section} className={cn('org-card', className)}>
    <CardHeader titleId={titleId} title={title} description={description} actions={actions} />
    {children && <div className="org-card-body">{children}</div>}
  </section>;
}
