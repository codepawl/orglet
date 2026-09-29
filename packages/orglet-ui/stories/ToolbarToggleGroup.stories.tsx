import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowUpRight, Circle, Crop, Highlighter, Pen, Square, Type } from 'lucide-react';
import { ToolbarToggleGroup, type ToolbarToggleItem } from '../src';

const meta = {
  title: 'Components/ToolbarToggleGroup',
  component: ToolbarToggleGroup,
} satisfies Meta<typeof ToolbarToggleGroup>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

const tools: ToolbarToggleItem[] = [
  { value: 'pen', label: 'Pen', icon: <Pen size={16} aria-hidden />, shortcut: 'P' },
  { value: 'highlighter', label: 'Highlighter', icon: <Highlighter size={16} aria-hidden />, shortcut: 'H' },
  { value: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={16} aria-hidden />, shortcut: 'A' },
  { value: 'rectangle', label: 'Rectangle', icon: <Square size={16} aria-hidden />, shortcut: 'R' },
  { value: 'ellipse', label: 'Ellipse', icon: <Circle size={16} aria-hidden />, shortcut: 'O' },
  { value: 'text', label: 'Text', icon: <Type size={16} aria-hidden />, shortcut: 'T' },
  { value: 'crop', label: 'Crop', icon: <Crop size={16} aria-hidden />, shortcut: 'C' },
];

const swatch = (color: string) => <span aria-hidden style={{ width: 14, height: 14, borderRadius: '50%', background: color, boxShadow: 'inset 0 0 0 1px #0000001f' }} />;
const colors: ToolbarToggleItem[] = [
  { value: 'accent', label: 'Accent', icon: swatch('var(--org-accent)') },
  { value: 'red', label: 'Red', icon: swatch('var(--org-error)') },
  { value: 'amber', label: 'Amber', icon: swatch('var(--org-warning)') },
  { value: 'green', label: 'Green', icon: swatch('var(--org-success)') },
];

const dot = (size: number) => <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: 'currentColor' }} />;
const widths: ToolbarToggleItem[] = [
  { value: 'thin', label: 'Thin', icon: dot(4) },
  { value: 'medium', label: 'Medium', icon: dot(7) },
  { value: 'thick', label: 'Thick', icon: dot(10) },
];

function MarkupBar() {
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('red');
  const [width, setWidth] = useState('medium');
  return <div role="toolbar" aria-label="Markup" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: 16, background: 'var(--org-bg)' }}>
    <ToolbarToggleGroup label="Tool" items={tools} value={tool} onValueChange={setTool} />
    <ToolbarToggleGroup label="Colour" items={colors} value={color} onValueChange={setColor} />
    <ToolbarToggleGroup label="Stroke width" items={widths} value={width} onValueChange={setWidth} />
  </div>;
}

/** A drawing bar: the tool, the colour and the stroke width, each one Tab stop picked with the arrow keys. */
export const Markup: Story = { render: () => <MarkupBar /> };
