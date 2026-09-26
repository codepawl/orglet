import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { FieldLabel, PanelHeading, type FieldLabelIcon } from '../src';

const Tag: FieldLabelIcon = ({ size }) => <svg data-testid="icon" width={size} height={size} />;

describe('PanelHeading', () => {
  it('puts the title at the level asked for, the description under it, and the actions beside it', () => {
    const { container } = render(<PanelHeading title="Schedules" description="Runs while the app is open." level={3} className="wide">
      <button type="button">New schedule</button>
    </PanelHeading>);
    expect(screen.getByRole('heading', { level: 3, name: 'Schedules' })).toBeTruthy();
    expect(screen.getByText('Runs while the app is open.').className).toBe('org-panel-heading-description');
    expect(container.querySelector('.org-panel-heading-actions')?.textContent).toBe('New schedule');
    expect(container.firstElementChild!.className).toBe('org-panel-heading wide');
  });

  it('leaves out the description and actions when there are none', () => {
    const { container } = render(<PanelHeading title="Data" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Data' })).toBeTruthy();
    expect(container.querySelector('.org-panel-heading-description')).toBeNull();
    expect(container.querySelector('.org-panel-heading-actions')).toBeNull();
  });
});

describe('FieldLabel', () => {
  it('shows a decorative icon at 15px and marks a required field without changing its name', () => {
    render(<label>
      <FieldLabel icon={Tag} required>Name</FieldLabel>
      <input />
    </label>);
    const icon = screen.getByTestId('icon');
    expect(icon.getAttribute('width')).toBe('15');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.getByText('Name').className).toBe('org-field-label org-field-label-required');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<div>
      <PanelHeading title="Connections" description="Keys stay on this computer." />
      <label><FieldLabel icon={Tag}>Base URL</FieldLabel><input /></label>
    </div>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
