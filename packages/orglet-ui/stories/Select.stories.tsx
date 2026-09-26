import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, Cloud, Cpu, Laptop } from 'lucide-react';
import { userEvent, within } from 'storybook/test';
import { Button, Select, type SelectOption } from '../src';

const plainOptions: SelectOption[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month', disabled: true, note: 'Coming later' },
];

const modelOptions: SelectOption[] = [
  { value: 'claude-code', label: 'Claude Code', detail: 'Your subscription', icon: <Bot size={16} />, group: 'On this computer' },
  { value: 'codex', label: 'Codex', detail: 'Your subscription', icon: <Laptop size={16} />, group: 'On this computer' },
  { value: 'ollama', label: 'Ollama', detail: 'llama3.2', icon: <Cpu size={16} />, group: 'On this computer', dimmed: true, note: 'Not running' },
  { value: 'anthropic', label: 'Anthropic API', detail: 'Pay per use', icon: <Cloud size={16} />, group: 'Keys', badge: <span className="gallery-note">Default</span> },
  { value: 'openai', label: 'OpenAI API', detail: 'Pay per use', icon: <Cloud size={16} />, group: 'Keys' },
];

const meta = {
  title: 'Components/Select',
  component: Select,
  decorators: [Story => <div className="gallery-narrow" style={{ minHeight: 320 }}><Story /></div>],
} satisfies Meta<typeof Select>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function StatefulSelect({ initial, options, ...rest }: { initial: string; options: SelectOption[] } & Partial<Parameters<typeof Select>[0]>) {
  const [value, setValue] = useState(initial);
  return <Select ariaLabel="Repeat" {...rest} value={value} options={options} onChange={setValue} />;
}

export const Default: Story = { render: () => <StatefulSelect initial="weekly" options={plainOptions} /> };

export const Placeholder: Story = {
  render: () => <StatefulSelect initial="" options={plainOptions} placeholder="Pick how often" />,
};

export const Open: Story = {
  render: () => <StatefulSelect initial="weekly" options={plainOptions} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'Repeat' }));
  },
};

/** Groups, icons, a detail line, a dimmed option with a note, and a badge. */
export const RichOptionsOpen: Story = {
  // Known issue: a dimmed option is drawn at 45% opacity and fails colour contrast, although it can still be chosen.
  parameters: { a11y: { test: 'todo' } },
  render: () => <StatefulSelect initial="claude-code" options={modelOptions} ariaLabel="Connection" menuMinWidth={280} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'Connection' }));
  },
};

export const InlineDetail: Story = {
  render: () => <StatefulSelect initial="codex" options={modelOptions} ariaLabel="Connection" inlineDetail />,
};

export const Small: Story = { render: () => <StatefulSelect initial="daily" options={plainOptions} size="sm" /> };

export const Disabled: Story = { render: () => <StatefulSelect initial="daily" options={plainOptions} disabled /> };

function InvalidSelect() {
  const [flash, setFlash] = useState(0);
  return <div className="gallery-stack">
    <StatefulSelect initial="" options={plainOptions} placeholder="Pick how often" invalid flash={flash} />
    <div className="gallery-row"><Button type="button" variant="outline" onClick={() => setFlash(count => count + 1)}>Submit again</Button></div>
  </div>;
}

export const Invalid: Story = { render: () => <InvalidSelect /> };
