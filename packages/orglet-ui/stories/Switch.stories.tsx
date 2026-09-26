import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Switch, SwitchField } from '../src';

const meta = {
  title: 'Components/Switch',
  component: Switch,
} satisfies Meta<typeof Switch>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function StatefulSwitch({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <Switch checked={checked} onChange={setChecked} disabled={disabled} label="Weekly report" />;
}

export const On: Story = { render: () => <StatefulSwitch initial /> };

export const Off: Story = { render: () => <StatefulSwitch initial={false} /> };

export const Disabled: Story = {
  render: () => <div className="gallery-row">
    <StatefulSwitch initial disabled />
    <StatefulSwitch initial={false} disabled />
  </div>,
};

function StatefulField({ initial, title, description, disabled }: { initial: boolean; title: string; description?: string; disabled?: boolean }) {
  const [checked, setChecked] = useState(initial);
  return <SwitchField checked={checked} onChange={setChecked} description={description} disabled={disabled}>{title}</SwitchField>;
}

/** The whole setting row: title on the left, description under it, the switch on the right. */
export const Field: Story = {
  name: 'SwitchField',
  render: () => <div className="gallery-stack">
    <StatefulField initial title="Weekly report" description="Every Monday morning" />
    <StatefulField initial={false} title="Read web pages" description="Lets this orglet open links you send it" />
    <StatefulField initial title="Sound on finish" />
  </div>,
};

export const FieldDisabled: Story = {
  name: 'SwitchField, disabled',
  // WCAG exempts the text of an inactive control from contrast; axe cannot tell this row belongs to a disabled switch.
  parameters: { a11y: { options: { rules: { 'color-contrast': { enabled: false } } } } },
  render: () => <div className="gallery-stack">
    <StatefulField initial disabled title="Run commands" description="Turned off by the crew's settings" />
  </div>,
};
