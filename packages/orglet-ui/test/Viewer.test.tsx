import { useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { Viewer } from '../src';

function Harness({ meta }: { meta?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open report</button>
    <Viewer open={open} onClose={() => setOpen(false)} id="report-viewer" title="Quarterly report.md" icon={<svg data-testid="kind-icon" />} meta={meta}
      actions={<button type="button">Copy</button>} closeLabel="Close document" closeIcon={<span>×</span>}>
      <article>Revenue grew.</article>
    </Viewer>
  </>;
}

describe('Viewer', () => {
  it('opens as a dialog named by its title, with the actions and the content, and closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open report' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Quarterly report.md' });
    expect(dialog.id).toBe('report-viewer');
    expect(screen.getByTestId('kind-icon')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(dialog.textContent).toContain('Revenue grew.');
    expect(document.querySelector('.org-viewer-meta')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close document' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('gives focus back to what opened it when Escape closes it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open report' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('leaves focus where an action inside it moved focus while closing it', async () => {
    const user = userEvent.setup();
    // As the app does: the link closes the viewer, and the panel it opens focuses its target once it has rendered.
    function LinkHarness() {
      const [open, setOpen] = useState(false);
      const [target, setTarget] = useState<string>();
      useEffect(() => {
        if (target) document.getElementById(target)?.focus();
      }, [target]);
      const goToChecker = () => {
        setOpen(false);
        setTarget('checker-1');
      };
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open report</button>
        <details id="checker-1" tabIndex={-1}><summary>Checker 1</summary></details>
        <Viewer open={open} onClose={() => setOpen(false)} title="Report" closeLabel="Close document" closeIcon={<span>×</span>}>
          <button type="button" onClick={goToChecker}>See checker 1</button>
        </Viewer>
      </>;
    }
    render(<LinkHarness />);
    await user.click(screen.getByRole('button', { name: 'Open report' }));
    await user.click(screen.getByRole('button', { name: 'See checker 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Radix hands focus back after closing on a timer; give it the chance to run.
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.activeElement?.id).toBe('checker-1');
  });

  it('shows the meta line under the title when given', async () => {
    const user = userEvent.setup();
    render(<Harness meta="Markdown · 2 KB" />);
    await user.click(screen.getByRole('button', { name: 'Open report' }));
    expect(document.querySelector('.org-viewer-heading .org-viewer-meta')?.textContent).toBe('Markdown · 2 KB');
  });

  it('puts an editing toolbar in its own row between the toolbar and the content', async () => {
    render(<Viewer open onClose={() => {}} title="photo.png" closeLabel="Close" closeIcon={<span>×</span>}
      toolbar={<div role="toolbar" aria-label="Markup"><button type="button">Pen</button></div>}>
      <p>Picture</p>
    </Viewer>);
    const tools = document.querySelector('.org-viewer-tools');
    expect(tools?.previousElementSibling?.className).toBe('org-viewer-toolbar');
    expect(tools?.nextElementSibling?.className).toBe('org-viewer-scroll');
    expect(screen.getByRole('toolbar', { name: 'Markup' })).toBeTruthy();
  });

  it('draws no tools row without a toolbar', async () => {
    render(<Viewer open onClose={() => {}} title="photo.png" closeLabel="Close" closeIcon={<span>×</span>}><p>Picture</p></Viewer>);
    expect(document.querySelector('.org-viewer-tools')).toBeNull();
  });

  it('closes on Escape and has no accessibility violations', async () => {
    const user = userEvent.setup();
    render(<Harness meta="Markdown · 2 KB" />);
    await user.click(screen.getByRole('button', { name: 'Open report' }));
    expect(await axe(document.body, { rules: { region: { enabled: false } } })).toHaveNoViolations();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
