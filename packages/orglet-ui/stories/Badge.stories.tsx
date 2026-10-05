import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge, StatusMark } from '../src';

const meta = {
  title: 'Components/Badge',
  component: Badge,
  args: { children: 'Draft' },
  argTypes: { tone: { control: 'inline-radio', options: ['neutral', 'accent', 'success', 'warning', 'error'] } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Accent: Story = { args: { tone: 'accent', children: 'New' } };

export const Success: Story = { args: { tone: 'success', children: 'Passed' } };

export const Warning: Story = { args: { tone: 'warning', children: 'Needs review' } };

export const ErrorTone: Story = { args: { tone: 'error', children: 'Failed' } };

export const Count: Story = { args: { tone: 'accent', count: 7, children: undefined } };

/** Past `max` (99 by default) a count reads `99+`. */
export const CountOverMax: Story = { args: { tone: 'accent', count: 240, children: undefined } };

/** A state says its word; the mark beside it is a second cue, so colour is never the only one. */
export const WithStatusMark: Story = {
  render: () => <div className="gallery-row">
    <StatusMark variant="filled" tone="success" label="Passed" decorative />
    <Badge tone="success">Passed</Badge>
    <StatusMark variant="filled" tone="error" label="Failed" decorative />
    <Badge tone="error">Failed</Badge>
  </div>,
};
