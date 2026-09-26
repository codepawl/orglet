import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '../src';

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  args: { children: 'Include attachments' },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const WithDescription: Story = {
  args: { defaultChecked: true, description: 'Files attached to this chat go with the copy.' },
};

/** The asterisk is drawn in CSS, so it never lands in the checkbox's name. */
export const Required: Story = { args: { children: 'I have read what this orglet may do', required: true } };

export const Disabled: Story = {
  render: () => <div className="gallery-stack">
    <Checkbox disabled>Include attachments</Checkbox>
    <Checkbox disabled defaultChecked>Include the chat history</Checkbox>
  </div>,
};

/** Picking items out of a list: the tick's job. An on/off setting is a Switch. */
export const PickFromAList: Story = {
  render: () => <fieldset className="gallery-stack" style={{ border: 0, margin: 0, padding: 0 }}>
    <legend className="gallery-note" style={{ marginBottom: 8 }}>Copy these to the new crew</legend>
    <Checkbox defaultChecked>Researcher</Checkbox>
    <Checkbox defaultChecked>Writer</Checkbox>
    <Checkbox>Reviewer</Checkbox>
  </fieldset>,
};
