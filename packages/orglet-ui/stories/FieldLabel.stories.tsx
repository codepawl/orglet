import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderOpen, Wallet } from 'lucide-react';
import { FieldLabel, Input } from '../src';

const meta = {
  title: 'Components/FieldLabel',
  component: FieldLabel,
  args: { icon: FolderOpen, children: 'Working folder' },
  argTypes: { icon: { control: false } },
} satisfies Meta<typeof FieldLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The asterisk is drawn, not written, so the field's name stays "Budget per day". */
export const Required: Story = { args: { icon: Wallet, children: 'Budget per day', required: true } };

export const AboveAField: Story = {
  render: () => <label className="gallery-label gallery-narrow">
    <FieldLabel icon={FolderOpen}>Working folder</FieldLabel>
    <Input defaultValue="C:\\Projects\\report" />
  </label>,
};
