import { useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnchoredPopover, Button, Checkbox } from '../src';

const meta = {
  title: 'Components/AnchoredPopover',
  component: AnchoredPopover,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AnchoredPopover>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function Filter({ initiallyOpen, align }: { initiallyOpen: boolean; align: 'start' | 'end' }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initiallyOpen);
  return <div style={{ display: 'flex', justifyContent: align === 'start' ? 'flex-start' : 'flex-end', padding: 24 }}>
    <Button ref={anchor} type="button" variant="outline" aria-expanded={open} onClick={() => setOpen(value => !value)}>Filter chats</Button>
    <AnchoredPopover anchor={anchor} open={open} onClose={() => setOpen(false)} label="Filter chats">
      <div className="gallery-stack" style={{ padding: 12, gap: 10 }}>
        <Checkbox defaultChecked>Orglets</Checkbox>
        <Checkbox defaultChecked>Crews</Checkbox>
        <Checkbox>Group chats</Checkbox>
      </div>
    </AnchoredPopover>
  </div>;
}

/** Below the trigger, lined up with its start edge. Escape or a pointer outside closes it. */
export const Open: Story = { render: () => <Filter initiallyOpen align="start" /> };

/** A trigger on the right half of the window lines the panel up with its end edge, so it stays inside. */
export const NearTheRightEdge: Story = { render: () => <Filter initiallyOpen align="end" /> };

export const Closed: Story = { render: () => <Filter initiallyOpen={false} align="start" /> };
