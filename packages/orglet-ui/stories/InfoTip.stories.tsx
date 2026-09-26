import type { Meta, StoryObj } from '@storybook/react-vite';
import { Info } from 'lucide-react';
import { fn, userEvent, within } from 'storybook/test';
import { InfoTip, type InfoTipRow } from '../src';

const rows: InfoTipRow[] = [
  { label: 'Chat id', value: 'task_01J9Z4K6W2M8Q3', mono: true, onCopy: fn() },
  { label: 'Folder', value: 'C:\\Projects\\report', mono: true, onCopy: fn() },
  { label: 'Started', value: '26 September 2026, 09:14' },
];

const meta = {
  title: 'Components/InfoTip',
  component: InfoTip,
  args: {
    label: 'Chat details',
    rows,
    icon: <Info size={16} aria-hidden />,
    copyLabel: rowLabel => `Copy ${rowLabel.toLowerCase()}`,
  },
  argTypes: { icon: { control: false } },
} satisfies Meta<typeof InfoTip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** A click pins it open, so a row's copy button can be reached. */
export const Pinned: Story = {
  decorators: [Story => <div style={{ paddingBottom: 160 }}><Story /></div>],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Chat details' }));
  },
};
