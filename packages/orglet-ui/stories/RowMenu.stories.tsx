import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Ellipsis, Pencil, Pin, Trash2 } from 'lucide-react';
import { fn, userEvent, within } from 'storybook/test';
import { RowMenu, StatusMark, type RowMenuItem } from '../src';

const items: RowMenuItem[] = [
  { label: 'Rename', icon: Pencil, onSelect: fn(), shortcut: 'F2' },
  { label: 'Pin to the top', icon: Pin, onSelect: fn() },
  { label: 'Duplicate', icon: Copy, onSelect: fn() },
  { label: 'Delete', icon: Trash2, onSelect: fn(), danger: true, confirm: { question: 'Delete this chat?', label: 'Delete' } },
];

const meta = {
  title: 'Components/RowMenu',
  component: RowMenu,
  args: { label: 'Chat actions', items, icon: Ellipsis, cancelLabel: 'No' },
  argTypes: { icon: { control: false } },
  decorators: [Story => <div style={{ minHeight: 240 }}>
    <div className="gallery-row" style={{ justifyContent: 'space-between', maxWidth: 360 }}>
      <span className="gallery-row"><StatusMark variant="empty" label="Idle" /> Weekly numbers</span>
      <Story />
    </div>
  </div>],
} satisfies Meta<typeof RowMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Chat actions' }));
  },
};

/** An item with `confirm` asks inside the panel before it acts. */
export const AskingFirst: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Chat actions' }));
    await userEvent.click(within(document.body).getByRole('menuitem', { name: 'Delete' }));
  },
};

/** A menu of one asking item opens straight on its question, so the trigger reads as that action. */
export const AsksOnOpen: Story = {
  args: { label: 'Delete chat', icon: Trash2, items: [items[3]], asksOnOpen: true },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete chat' }));
  },
};

/** A right-click anywhere in the row opens the same menu at the pointer. */
export const AsAContextMenu: Story = {
  args: { contextMenuOf: '.gallery-context-row' },
  decorators: [Story => <div className="gallery-context-row gallery-panel" style={{ maxWidth: 360 }}>
    <p className="gallery-note">Right-click anywhere in this row.</p>
    <Story />
  </div>],
};

export const Disabled: Story = { args: { disabled: true } };
