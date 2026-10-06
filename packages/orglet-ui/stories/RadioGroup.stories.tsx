import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { RadioGroup, type RadioOption } from '../src';

const options: RadioOption[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'never', label: 'Never' },
];

const meta = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  args: { label: 'Send the report', options, value: 'weekly', onChange: () => undefined },
  render: args => {
    const [value, setValue] = useState(args.value);
    return <RadioGroup {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithDescriptions: Story = {
  args: {
    options: [
      { value: 'daily', label: 'Every day', description: 'At 08:00 on workdays' },
      { value: 'weekly', label: 'Every week', description: 'Monday morning' },
      { value: 'never', label: 'Never', description: 'Run it by hand' },
    ],
  },
};

export const Required: Story = { args: { required: true, value: '' } };

export const WithDisabledOption: Story = {
  args: { options: [options[0], { ...options[1], disabled: true }, options[2]] },
};

export const Disabled: Story = { args: { disabled: true } };
