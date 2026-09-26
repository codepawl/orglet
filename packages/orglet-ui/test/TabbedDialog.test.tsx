import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { TabbedDialog, TabbedFormDialog, type DialogTab } from '../src';

type Section = 'general' | 'members' | 'budget';
const sections: DialogTab<Section>[] = [
  { id: 'general', label: 'General' },
  { id: 'members', label: 'Members' },
  { id: 'budget', label: 'Budget' },
];

function SettingsHarness({ onHover = () => {} }: { onHover?: () => void }) {
  const [tab, setTab] = useState<Section>('general');
  const tabs = sections.map(section => section.id === 'budget' ? { ...section, buttonProps: { onPointerEnter: onHover } } : section);
  return <TabbedDialog open onClose={() => {}} title="Settings" closeLabel="Close settings" closeIcon={<span>×</span>} tabsLabel="Sections"
    tabs={tabs} tab={tab} onTab={setTab} panelId="settings-panel" description={`About ${tab}`} actions={<button type="button">Add</button>}>
    <p>Body of {tab}</p>
  </TabbedDialog>;
}

function EditorHarness({ onSubmit, error, busy = false, focusField }: { onSubmit: () => void; error?: string; busy?: boolean; focusField?: string }) {
  const [tab, setTab] = useState<Section>('general');
  const [open, setOpen] = useState(true);
  return <TabbedFormDialog open={open} onClose={() => setOpen(false)} title="Crew" closeLabel="Close crew" closeIcon={<span>×</span>}
    tabs={sections} tab={tab} onTab={setTab} panelId="crew-panel" onSubmit={onSubmit} submitLabel="Save" busyLabel="Saving…" cancelLabel="Cancel"
    busy={busy} error={error} focusField={focusField} fieldsClassName="fields">
    <label>Name <input data-field="name" /></label>
    <label>Goal <input data-field="goal" /></label>
  </TabbedFormDialog>;
}

/** Settings the way the app opens it: from a button, with `open` in state and no Radix trigger. */
function OpenedSettingsHarness() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Section>('general');
  return <>
    <button type="button" onClick={() => setOpen(true)}>Settings</button>
    <TabbedDialog open={open} onClose={() => setOpen(false)} title="Settings" closeLabel="Close settings" closeIcon={<span>×</span>}
      tabs={sections} tab={tab} onTab={setTab} panelId="opened-settings-panel">
      <p>Body of {tab}</p>
    </TabbedDialog>
  </>;
}

/** An editor opened from a button that lands on a named field. */
function OpenedEditorHarness() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Section>('general');
  return <>
    <button type="button" onClick={() => setOpen(true)}>Edit crew</button>
    <TabbedFormDialog open={open} onClose={() => setOpen(false)} title="Crew" closeLabel="Close crew" closeIcon={<span>×</span>}
      tabs={sections} tab={tab} onTab={setTab} panelId="opened-crew-panel" onSubmit={() => {}} submitLabel="Save" busyLabel="Saving…"
      cancelLabel="Cancel" busy={false} focusField="goal">
      <label>Goal <input data-field="goal" /></label>
    </TabbedFormDialog>
  </>;
}

describe('TabbedDialog', () => {
  it('heads the panel with the open tab, its description and actions, and moves between tabs with the arrows', async () => {
    const user = userEvent.setup();
    render(<SettingsHarness />);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    const panel = screen.getByRole('tabpanel', { name: 'General' });
    expect(panel.textContent).toContain('About general');
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
    const general = screen.getByRole('tab', { name: 'General' });
    expect(general.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Members' }).getAttribute('tabindex')).toBe('-1');
    general.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('tab', { name: 'Members' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.id).toBe('settings-panel-tab-members');
    expect(screen.getByRole('tabpanel').textContent).toContain('Body of members');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('tab', { name: 'Budget' }).getAttribute('aria-selected')).toBe('true');
  });

  it('passes buttonProps to a tab', async () => {
    const user = userEvent.setup();
    const onHover = vi.fn();
    render(<SettingsHarness onHover={onHover} />);
    await user.hover(screen.getByRole('tab', { name: 'Budget' }));
    expect(onHover).toHaveBeenCalled();
  });

  it('gives focus back to the button that opened it when Escape closes it', async () => {
    const user = userEvent.setup();
    render(<OpenedSettingsHarness />);
    const opener = screen.getByRole('button', { name: 'Settings' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Settings' }).contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('has no accessibility violations', async () => {
    render(<SettingsHarness />);
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});

describe('TabbedFormDialog', () => {
  it('submits from any tab with Save and closes with Cancel', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<EditorHarness onSubmit={onSubmit} />);
    await user.click(screen.getByRole('tab', { name: 'Budget' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the error beside the buttons and the busy label while saving', () => {
    render(<EditorHarness onSubmit={() => {}} error="Name is required" busy />);
    expect(screen.getByRole('alert').textContent).toBe('Name is required');
    const save = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('gives focus back to what opened it after landing on a named field', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const user = userEvent.setup();
    render(<OpenedEditorHarness />);
    const opener = screen.getByRole('button', { name: 'Edit crew' });
    await user.click(opener);
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.field).toBe('goal'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('lands on the named field when it opens', async () => {
    // The test DOM does not lay anything out, so it has no scrolling to do.
    Element.prototype.scrollIntoView = vi.fn();
    render(<EditorHarness onSubmit={() => {}} focusField="goal" />);
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.field).toBe('goal'));
  });
});
