import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Attachment, fileKind, formatFileSize } from '../src';

describe('fileKind and formatFileSize', () => {
  it('reads the kind from the extension, ignoring case, and falls back to file', () => {
    expect(fileKind('report.PDF')).toBe('document');
    expect(fileKind('data.jsonl')).toBe('data');
    expect(fileKind('photo.heic')).toBe('image');
    expect(fileKind('.env')).toBe('file');
    expect(fileKind('Makefile')).toBe('file');
  });

  it('shows one decimal under ten and whole numbers above', () => {
    expect(formatFileSize(512, 'en-US')).toBe('512 B');
    expect(formatFileSize(1536, 'en-US')).toBe('1.5 KB');
    expect(formatFileSize(20 * 1024 * 1024, 'en-US')).toBe('20 MB');
    expect(formatFileSize(1536, 'vi-VN')).toBe('1,5 KB');
  });
});

describe('Attachment', () => {
  it('shows the name and meta, and a remove button named by its label', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<ul><Attachment name="notes.md" meta="Document · 2 KB" icon={<span>F</span>} onRemove={onRemove} removeLabel="Remove notes.md" removeIcon="×" /></ul>);
    expect(screen.getByRole('listitem').getAttribute('title')).toBe('notes.md');
    expect(screen.getByText('Document · 2 KB').className).toBe('org-attachment-meta');
    await user.click(screen.getByRole('button', { name: 'Remove notes.md' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('is one button that opens the file when it can be opened', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ul><Attachment name="invoice.pdf" meta="Document · 90 KB" icon={<span>F</span>} onOpen={onOpen} /></ul>);
    await user.click(screen.getByRole('button', { name: /invoice\.pdf/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<ul>
      <Attachment name="a.csv" meta="Spreadsheet · 1 KB" icon={<span>F</span>} onRemove={() => undefined} removeLabel="Remove a.csv" removeIcon="×" />
      <Attachment name="b.png" meta="Image" icon={<span>F</span>} onOpen={() => undefined} />
    </ul>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
