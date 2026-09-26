import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, Input, Textarea } from '../src';

const meta = {
  title: 'Components/Input and Textarea',
  component: Input,
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <label className="gallery-label gallery-narrow">
    Name
    <Input defaultValue="Researcher" />
  </label>,
};

export const Placeholder: Story = {
  render: () => <Input className="gallery-narrow" aria-label="Search" placeholder="Search orglets" />,
};

export const Disabled: Story = {
  render: () => <Input className="gallery-narrow" aria-label="Folder" defaultValue="C:\\Projects\\report" disabled />,
};

/** Every failed submit bumps `flash`, so the same bad value shakes each time. */
export const Invalid: Story = {
  render: function InvalidField() {
    const [flash, setFlash] = useState(0);
    return <div className="gallery-stack gallery-narrow">
      <label className="gallery-label">
        Budget per day
        <Input invalid flash={flash} defaultValue="ten dollars" />
      </label>
      <div className="gallery-row">
        <Button type="button" variant="outline" onClick={() => setFlash(count => count + 1)}>Submit again</Button>
      </div>
    </div>;
  },
};

export const TextareaField: Story = {
  name: 'Textarea',
  render: () => <label className="gallery-label" style={{ maxWidth: 420 }}>
    Instructions
    <Textarea rows={4} defaultValue="Read the attached report and list the three numbers that moved the most since last week." />
  </label>,
};

export const TextareaInvalid: Story = {
  name: 'Textarea, invalid',
  render: () => <label className="gallery-label" style={{ maxWidth: 420 }}>
    Instructions
    <Textarea rows={3} invalid defaultValue="" />
  </label>,
};
