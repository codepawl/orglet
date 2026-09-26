import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyRound, Palette, Plus, Settings, Wallet, X } from 'lucide-react';
import { Button, DialogTabs, Input, Select, SwitchField, TabbedDialog, TabbedFormDialog, type DialogTab } from '../src';

type SettingsSection = 'general' | 'appearance' | 'connections' | 'budget';

const settingsTabs: DialogTab<SettingsSection>[] = [
  { id: 'general', label: 'General', icon: <Settings size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'connections', label: 'Connections', icon: <KeyRound size={16} /> },
  { id: 'budget', label: 'Budget', icon: <Wallet size={16} /> },
];

const descriptions: Record<SettingsSection, string> = {
  general: 'How Orglet starts and what it tells you.',
  appearance: 'Theme and text size.',
  connections: 'The accounts and keys your orglets can use.',
  budget: 'What a day of work may cost.',
};

const meta = {
  title: 'Components/Tabbed dialogs',
  component: TabbedDialog,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TabbedDialog>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;


function SettingsDemo() {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<SettingsSection>('general');
  const [startup, setStartup] = useState(true);
  const [sounds, setSounds] = useState(false);
  const [theme, setTheme] = useState('system');
  return <div style={{ padding: 24 }}>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open settings</Button>
    <TabbedDialog open={open} onClose={() => setOpen(false)} title="Settings" closeLabel="Close settings" closeIcon={<X size={16} aria-hidden />}
      tabsLabel="Sections" tabs={settingsTabs} tab={tab} onTab={setTab} panelId="settings-panel" description={descriptions[tab]}
      actions={tab === 'connections' ? <Button type="button" variant="outline"><Plus size={16} aria-hidden /> Add</Button> : undefined}>
      {tab === 'general' && <div className="gallery-stack" style={{ maxWidth: 'none' }}>
        <SwitchField checked={startup} onChange={setStartup} description="Opens in the tray when you sign in">Start with Windows</SwitchField>
        <SwitchField checked={sounds} onChange={setSounds}>Sound when an answer arrives</SwitchField>
      </div>}
      {tab === 'appearance' && <div className="gallery-narrow">
        <Select ariaLabel="Theme" value={theme} onChange={setTheme}
          options={[{ value: 'system', label: 'Follow the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </div>}
      {tab === 'connections' && <p className="gallery-note">No connections yet.</p>}
      {tab === 'budget' && <p className="gallery-note">No limit set.</p>}
    </TabbedDialog>
  </div>;
}

/** Changes apply at once. The tabs sit on the left, or in a row on a narrow window. */
export const SettingsDialog: Story = { name: 'TabbedDialog', render: () => <SettingsDemo /> };

type CrewSection = 'about' | 'members' | 'budget';

const crewTabs: DialogTab<CrewSection>[] = [
  { id: 'about', label: 'About' },
  { id: 'members', label: 'Members' },
  { id: 'budget', label: 'Budget' },
];

function CrewEditor({ error, busy }: { error?: string; busy?: boolean }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<CrewSection>('about');
  return <div style={{ padding: 24 }}>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Edit crew</Button>
    <TabbedFormDialog open={open} onClose={() => setOpen(false)} title="Research crew" closeLabel="Close" closeIcon={<X size={16} aria-hidden />}
      tabs={crewTabs} tab={tab} onTab={setTab} panelId="crew-panel" onSubmit={() => setOpen(false)}
      submitLabel="Save" busyLabel="Saving…" cancelLabel="Cancel" busy={busy ?? false} error={error} focusField={error ? 'name' : undefined}
      fieldsClassName="gallery-form">
      <label className="gallery-label">
        Name
        <Input data-field="name" defaultValue={error ? '' : 'Research crew'} invalid={Boolean(error)} />
      </label>
      <label className="gallery-label">
        Goal
        <Input data-field="goal" defaultValue="Read the week's reports and say what changed." />
      </label>
    </TabbedFormDialog>
  </div>;
}

/** Cancel and Save pinned at the bottom. */
export const FormDialog: Story = { name: 'TabbedFormDialog', render: () => <CrewEditor /> };

/** A failed save: the error beside the buttons, focus on the field it names. */
export const FormDialogWithError: Story = {
  name: 'TabbedFormDialog, error',
  render: () => <CrewEditor error="A crew needs a name." />,
};

export const FormDialogSaving: Story = { name: 'TabbedFormDialog, saving', render: () => <CrewEditor busy /> };

function TabsAlone() {
  const [tab, setTab] = useState<SettingsSection>('appearance');
  return <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24, maxWidth: 640 }}>
    <DialogTabs label="Sections" tabs={settingsTabs} value={tab} onChange={setTab} panelId="tabs-alone-panel" />
    <div id="tabs-alone-panel" role="tabpanel" aria-labelledby={`tabs-alone-panel-tab-${tab}`}>
      <p style={{ margin: 0 }}>{descriptions[tab]}</p>
    </div>
  </div>;
}

/** Just the tab list, for a layout of an application's own. */
export const TabsOnly: Story = { name: 'DialogTabs', render: () => <TabsAlone /> };
