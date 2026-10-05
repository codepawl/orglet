import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { TabPanel, Tabs, type TabItem } from '../src';

const tabs: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files', disabled: true },
  { id: 'history', label: 'History' },
];

function Example({ className }: { className?: string }) {
  const [value, setValue] = useState('overview');
  return <div>
    <Tabs id="report" label="Report sections" tabs={tabs} value={value} onChange={setValue} className={className} />
    {tabs.map(tab => <TabPanel key={tab.id} tabsId="report" tabId={tab.id} value={value}>{tab.label} content</TabPanel>)}
  </div>;
}

describe('Tabs', () => {
  it('renders the tab list with the open tab selected and only it in the Tab order', () => {
    render(<Example />);
    expect(screen.getByRole('tablist', { name: 'Report sections' })).toBeTruthy();
    const overview = screen.getByRole('tab', { name: 'Overview' });
    expect(overview.getAttribute('aria-selected')).toBe('true');
    expect(overview.tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'History' }).tabIndex).toBe(-1);
  });

  it('wires each tab to its panel both ways', () => {
    render(<Example />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(overview.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(overview.id);
    expect(screen.queryByRole('tabpanel', { name: 'History' })).toBeNull();
  });

  it('opens the next tab with the arrow keys, skipping a disabled one, and with Home and End', async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    const history = screen.getByRole('tab', { name: 'History' });
    expect(history.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(history);
    expect(screen.getByRole('tabpanel', { name: 'History' })).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(history);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview' }));
  });

  it('opens a tab on click and applies className last', async () => {
    const user = userEvent.setup();
    render(<Example className="wide" />);
    await user.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('tabpanel', { name: 'History' })).toBeTruthy();
    expect(screen.getByRole('tablist').className).toBe('org-tabs wide');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Example />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
