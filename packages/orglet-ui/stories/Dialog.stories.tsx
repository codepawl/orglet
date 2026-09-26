import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as RadixDialog from '@radix-ui/react-dialog';
import { ChevronRight, Plus, X } from 'lucide-react';
import { userEvent, within } from 'storybook/test';
import { Button, Confirmer, DialogOverlay, Drawer, Select, SwitchField, confirmAction, keepOpenForPopup } from '../src';

const meta = {
  title: 'Components/Dialogs',
  component: Drawer,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Drawer>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function Page({ children }: { children: ReactNode }) {
  return <div style={{ padding: 24, minHeight: '100vh', boxSizing: 'border-box' }}>{children}</div>;
}

function DrawerDemo({ breadcrumb }: { breadcrumb?: boolean }) {
  const [open, setOpen] = useState(true);
  const [weekly, setWeekly] = useState(true);
  const title = breadcrumb
    ? <span className="gallery-row" style={{ gap: 4 }}>Crews <ChevronRight size={14} aria-hidden /> Research crew</span>
    : 'Schedules';
  return <Page>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open the drawer</Button>
    <Drawer open={open} onClose={() => setOpen(false)} title={title} description="Runs that start on their own."
      closeLabel="Close" closeIcon={<X size={16} aria-hidden />}
      actions={<Button type="button" variant="outline"><Plus size={16} aria-hidden /> Add</Button>}>
      <div className="gallery-stack" style={{ maxWidth: 'none' }}>
        <SwitchField checked={weekly} onChange={setWeekly} description="Every Monday at 9:00">Weekly report</SwitchField>
        {Array.from({ length: 12 }, (_, index) => <p key={index} style={{ margin: 0 }}>
          Line {index + 1} of a body long enough to scroll on its own while the header stays put.
        </p>)}
      </div>
    </Drawer>
  </Page>;
}

export const DrawerOpen: Story = {
  name: 'Drawer',
  render: () => <DrawerDemo />,
};

export const DrawerWithBreadcrumb: Story = {
  name: 'Drawer, breadcrumb title',
  render: () => <DrawerDemo breadcrumb />,
};

function ConfirmDemo() {
  const [answer, setAnswer] = useState('Nothing asked yet.');
  const ask = async () => {
    const confirmed = await confirmAction({
      title: 'Delete this chat?',
      description: 'Its messages and files go too. This cannot be undone.',
      confirmLabel: 'Delete',
    });
    setAnswer(confirmed ? 'Confirmed.' : 'Cancelled.');
  };
  return <Page>
    <div className="gallery-stack">
      <div className="gallery-row"><Button type="button" variant="outline" onClick={() => void ask()}>Delete chat</Button></div>
      <p className="gallery-note" aria-live="polite">{answer}</p>
    </div>
    <Confirmer confirmLabel="OK" cancelLabel="Cancel" />
  </Page>;
}

/** `await confirmAction(...)` resolves true only on confirm; one `<Confirmer>` shows the question. */
export const ConfirmActionQuestion: Story = {
  name: 'confirmAction and Confirmer',
  render: () => <ConfirmDemo />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete chat' }));
  },
};

const models = [
  { value: 'small', label: 'Small', detail: 'Quick answers' },
  { value: 'large', label: 'Large', detail: 'Careful work' },
];

function OverlayDemo() {
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState('small');
  return <Page>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open the dialog</Button>
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <DialogOverlay />
        <RadixDialog.Content onEscapeKeyDown={keepOpenForPopup} aria-describedby={undefined} className="gallery-panel"
          style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(360px, calc(100vw - 32px))', background: 'var(--org-bg)', boxSizing: 'border-box' }}>
          <RadixDialog.Title style={{ margin: '0 0 12px', fontSize: 16 }}>Your own dialog</RadixDialog.Title>
          <div className="gallery-stack">
            <p className="gallery-note">The frosted backdrop is <code>DialogOverlay</code>. Open the list and press Escape: the list closes, the dialog stays.</p>
            <Select ariaLabel="Model" value={model} options={models} onChange={setModel} />
            <div className="gallery-row" style={{ justifyContent: 'flex-end' }}>
              <RadixDialog.Close asChild><Button type="button" variant="primary">Done</Button></RadixDialog.Close>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  </Page>;
}

/** The backdrop and the Escape rule, for an application's own Radix dialog. */
export const OverlayAndEscapeRule: Story = {
  name: 'DialogOverlay and keepOpenForPopup',
  render: () => <OverlayDemo />,
};
