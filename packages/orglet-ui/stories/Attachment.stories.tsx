import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Archive, File, FileCode, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideo, Database, X } from 'lucide-react';
import { fn } from 'storybook/test';
import { Attachment, fileKind, formatFileSize, type FileKind } from '../src';

const iconByKind: Record<FileKind, ReactNode> = {
  image: <FileImage size={18} />,
  video: <FileVideo size={18} />,
  audio: <FileMusic size={18} />,
  document: <FileText size={18} />,
  spreadsheet: <FileSpreadsheet size={18} />,
  data: <Database size={18} />,
  code: <FileCode size={18} />,
  archive: <Archive size={18} />,
  text: <FileText size={18} />,
  file: <File size={18} />,
};

type SampleFile = { name: string; bytes: number };

const files: SampleFile[] = [
  { name: 'weekly-numbers.xlsx', bytes: 48_213 },
  { name: 'board-deck-final-final-v3.pdf', bytes: 2_411_724 },
  { name: 'screenshot.png', bytes: 312_004 },
  { name: 'export.csv', bytes: 1_240 },
  { name: 'notes', bytes: 812 },
];

function metaLine(file: SampleFile) {
  return `${fileKind(file.name)}, ${formatFileSize(file.bytes, 'en-US')}`;
}

const meta = {
  title: 'Components/Attachment',
  component: Attachment,
  decorators: [Story => <ul className="gallery-list" style={{ maxWidth: 620 }}><Story /></ul>],
} satisfies Meta<typeof Attachment>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

/** A sent message's files: the whole card opens the file. */
export const Openable: Story = {
  render: () => <>
    {files.map(file => <Attachment key={file.name} name={file.name} meta={metaLine(file)} icon={iconByKind[fileKind(file.name)]} onOpen={fn()} />)}
  </>,
};

function RemovableFiles() {
  const [attached, setAttached] = useState(files.slice(0, 3));
  return <>
    {attached.map(file => <Attachment key={file.name} name={file.name} meta={metaLine(file)} icon={iconByKind[fileKind(file.name)]}
      onRemove={() => setAttached(current => current.filter(item => item !== file))}
      removeLabel={`Remove ${file.name}`} removeIcon={<X size={14} aria-hidden />} />)}
  </>;
}

/** Files waiting in the composer: the remove button shows on hover or focus, without moving anything. */
export const Removable: Story = {
  render: () => <RemovableFiles />,
};

/** What `fileKind` reads from each extension, drawn with the icon an app would pick for it. */
export const EveryKind: Story = {
  render: () => <>
    {['photo.jpg', 'clip.mp4', 'voice.m4a', 'contract.docx', 'budget.xlsx', 'rows.parquet', 'main.ts', 'backup.zip', 'readme.md', 'unknown.xyz']
      .map(name => <Attachment key={name} name={name} meta={fileKind(name)} icon={iconByKind[fileKind(name)]} />)}
  </>,
};
