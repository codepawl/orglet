import type { Meta, StoryObj } from '@storybook/react-vite';
import { Settings, Trash2 } from 'lucide-react';
import { Button, Tooltip } from '../src';

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  args: { label: 'Delete', children: <Button type="button" size="icon" aria-label="Delete"><Trash2 size={16} aria-hidden /></Button> },
  argTypes: {
    side: { control: 'inline-radio', options: ['top', 'bottom'] },
    children: { control: false },
  },
  decorators: [Story => <div className="gallery-padded"><Story /></div>],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hover the button for a moment, or tab to it. */
export const Top: Story = {};

export const Bottom: Story = { args: { side: 'bottom' } };

export const WithShortcut: Story = {
  args: {
    label: 'Settings',
    shortcut: 'Ctrl+,',
    children: <Button type="button" size="icon" aria-label="Settings"><Settings size={16} aria-hidden /></Button>,
  },
};
