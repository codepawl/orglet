import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowUpRight, Download, FileCode, FileImage, FileText, Pen, Square, X } from 'lucide-react';
import { Button, ToolbarToggleGroup, Viewer, type ToolbarToggleItem } from '../src';

const meta = {
  title: 'Components/Viewer',
  component: Viewer,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Viewer>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

const page = { maxWidth: 640, margin: '24px auto', padding: '32px 40px', borderRadius: 8, background: 'var(--org-bg)', color: 'var(--org-text)' };

function DocumentViewer() {
  const [open, setOpen] = useState(true);
  return <div style={{ padding: 24 }}>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open the report</Button>
    <Viewer open={open} onClose={() => setOpen(false)} title="weekly-report.md" icon={<FileText size={16} aria-hidden />}
      meta="Markdown, 4 KB" closeLabel="Close" closeIcon={<X size={16} aria-hidden />}
      actions={<Button type="button" size="icon" aria-label="Download" title="Download"><Download size={16} aria-hidden /></Button>}>
      <article style={page}>
        <h1 style={{ marginTop: 0, fontSize: 22 }}>Weekly report</h1>
        {Array.from({ length: 8 }, (_, index) => <p key={index}>
          Paragraph {index + 1}. Three numbers moved more than ten percent since last week; the notes below say which and why,
          and what the crew suggests doing about each one.
        </p>)}
      </article>
    </Viewer>
  </div>;
}

/** A document on the grey backdrop: close on the left, the name centred with its meta line, actions on the right. */
export const Document: Story = { render: () => <DocumentViewer /> };

const diffLines = [
  '@@ -12,7 +12,8 @@ export function total(rows) {',
  '-  return rows.reduce((sum, row) => sum + row.amount, 0);',
  '+  const amounts = rows.map(row => row.amount ?? 0);',
  '+  return amounts.reduce((sum, amount) => sum + amount, 0);',
  ' }',
];

function DiffViewer() {
  const [open, setOpen] = useState(true);
  return <div style={{ padding: 24 }}>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open the change</Button>
    <Viewer open={open} onClose={() => setOpen(false)} title="src/total.ts" icon={<FileCode size={16} aria-hidden />}
      closeLabel="Close" closeIcon={<X size={16} aria-hidden />}>
      <pre style={{ ...page, fontFamily: 'var(--org-font-mono)', fontSize: 13, overflowX: 'auto' }}>{diffLines.join('\n')}</pre>
    </Viewer>
  </div>;
}

const markupTools: ToolbarToggleItem[] = [
  { value: 'pen', label: 'Pen', icon: <Pen size={16} aria-hidden />, shortcut: 'P' },
  { value: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={16} aria-hidden />, shortcut: 'A' },
  { value: 'rectangle', label: 'Rectangle', icon: <Square size={16} aria-hidden />, shortcut: 'R' },
];

function EditingViewer() {
  const [open, setOpen] = useState(true);
  const [tool, setTool] = useState('arrow');
  return <div style={{ padding: 24 }}>
    <Button type="button" variant="outline" onClick={() => setOpen(true)}>Mark up the picture</Button>
    <Viewer open={open} onClose={() => setOpen(false)} title="screenshot.png" icon={<FileImage size={16} aria-hidden />}
      meta="Image, 240 KB" closeLabel="Close" closeIcon={<X size={16} aria-hidden />}
      actions={<Button type="button" variant="primary">Save as new version</Button>}
      toolbar={<div role="toolbar" aria-label="Markup" style={{ display: 'contents' }}>
        <ToolbarToggleGroup label="Tool" items={markupTools} value={tool} onValueChange={setTool} />
      </div>}>
      <div style={{ ...page, height: 320, display: 'grid', placeItems: 'center' }}>The picture being marked up</div>
    </Viewer>
  </div>;
}

/** An editing mode: the tools in their own row under the toolbar, which stays put while the content scrolls. */
export const WithTools: Story = { render: () => <EditingViewer /> };

/** Without meta or actions the toolbar keeps only the close button and the centred name. */
export const TitleOnly: Story = { render: () => <DiffViewer /> };
