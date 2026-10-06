import type { Meta, StoryObj } from '@storybook/react-vite';
import { Progress } from '../src';

const meta = {
  title: 'Components/Progress',
  component: Progress,
  args: { label: 'Upload progress', value: 40 },
  decorators: [Story => <div className="gallery-stack"><Story /></div>],
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValueText: Story = { args: { label: 'Files copied', value: 3, max: 12, valueText: '3 of 12' } };

export const Empty: Story = { args: { value: 0, valueText: '0%' } };

export const Done: Story = { args: { value: 100, valueText: '100%' } };
