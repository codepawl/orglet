import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { EditableText } from '../src';

const meta = {
  title: 'Components/EditableText',
  component: EditableText,
} satisfies Meta<typeof EditableText>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function Renamable({ initial, disabled, failing }: { initial: string; disabled?: boolean; failing?: boolean }) {
  const [name, setName] = useState(initial);
  const [message, setMessage] = useState('');
  const commit = async (next: string) => {
    await new Promise(resolve => setTimeout(resolve, 400));
    if (failing) {
      setMessage('Could not rename; the old name is back.');
      throw new Error('rename failed');
    }
    setName(next);
    setMessage(`Renamed to ${next}.`);
  };
  return <div className="gallery-stack">
    <h2 style={{ margin: 0, fontSize: 18 }}>
      <EditableText value={name} onCommit={commit} label={`Rename ${name}`} maxLength={40} disabled={disabled} />
    </h2>
    <p className="gallery-note" aria-live="polite">{message || 'Click the name, or focus it and press Enter or F2.'}</p>
  </div>;
}

export const AtRest: Story = { render: () => <Renamable initial="Researcher" /> };

export const Editing: Story = {
  render: () => <Renamable initial="Researcher" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Rename Researcher' }));
  },
};

export const Disabled: Story = { render: () => <Renamable initial="Researcher" disabled /> };

/** The save throws: the new text shows while it runs, then the old name comes back. */
export const SaveFails: Story = { render: () => <Renamable initial="Researcher" failing /> };
