import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Settings, Trash2 } from 'lucide-react';
import { Button } from '../src';

const meta = {
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save changes', type: 'button' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['ghost', 'outline', 'primary', 'danger'] },
    size: { control: 'inline-radio', options: ['default', 'icon'] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ghost: Story = { args: { variant: 'ghost', children: 'Show details' } };

export const Outline: Story = { args: { variant: 'outline', children: 'Cancel' } };

export const Primary: Story = { args: { variant: 'primary' } };

export const Danger: Story = { args: { variant: 'danger', children: 'Delete' } };

export const Disabled: Story = { args: { variant: 'primary', disabled: true } };

export const IconOnly: Story = {
  args: { size: 'icon', 'aria-label': 'Settings', title: 'Settings', children: <Settings size={16} aria-hidden /> },
};

export const WithLeadingIcon: Story = {
  args: { variant: 'outline', children: <><Plus size={16} aria-hidden /> New orglet</> },
};

/** A place has one primary action; the rest step down to outline and ghost. */
export const AllTogether: Story = {
  render: () => <div className="gallery-row">
    <Button type="button" variant="primary">Save</Button>
    <Button type="button" variant="outline">Cancel</Button>
    <Button type="button">Show details</Button>
    <Button type="button" size="icon" aria-label="Delete" title="Delete"><Trash2 size={16} aria-hidden /></Button>
  </div>,
};
