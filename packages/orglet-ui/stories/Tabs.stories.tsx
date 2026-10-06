import { useId, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileText, History, Settings } from 'lucide-react';
import { TabPanel, Tabs, type TabItem } from '../src';

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

function Example({ tabs }: { tabs: readonly TabItem[] }) {
  const id = useId();
  const [value, setValue] = useState(tabs[0].id);
  return <div className="gallery-stack">
    <Tabs id={id} label="Report sections" tabs={tabs} value={value} onChange={setValue} />
    {tabs.map(tab => <TabPanel key={tab.id} tabsId={id} tabId={tab.id} value={value}>
      <p className="gallery-note">The {tab.label.toLowerCase()} tab. Tab from the list lands here.</p>
    </TabPanel>)}
  </div>;
}

const plainTabs: TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files' },
  { id: 'history', label: 'History' },
];

/** The arrow keys, Home and End move and open; only the open tab is in the Tab order. */
export const Default: Story = { args: { id: 'x', label: 'x', tabs: plainTabs, value: 'overview', onChange: () => undefined }, render: () => <Example tabs={plainTabs} /> };

export const WithIcons: Story = {
  args: Default.args,
  render: () => <Example tabs={[
    { id: 'overview', label: 'Overview', icon: <FileText size={15} /> },
    { id: 'history', label: 'History', icon: <History size={15} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={15} /> },
  ]} />,
};

/** A disabled tab is skipped by the arrow keys. */
export const WithDisabledTab: Story = {
  args: Default.args,
  render: () => <Example tabs={[
    { id: 'overview', label: 'Overview' },
    { id: 'files', label: 'Files', disabled: true },
    { id: 'history', label: 'History' },
  ]} />,
};
