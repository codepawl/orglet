import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, ColorPicker, type ColorPickerLabels } from '../src';

const labels: ColorPickerLabels = {
  panel: 'Pick a colour',
  area: 'Saturation and brightness',
  areaValue: (saturation, brightness) => `Saturation ${saturation}%, brightness ${brightness}%`,
  hue: 'Hue',
  hex: 'Hex',
  save: 'Save colour',
  presets: 'Presets',
  saved: 'Saved colours',
  presetColor: color => `Use ${color}`,
  savedColor: color => `Use saved ${color}`,
  removeColor: color => `Remove ${color}`,
  removeTitle: 'Remove',
  done: 'Done',
};

const presets = ['#4473d3', '#2e7a32', '#a82626', '#9a7b2f', '#7a4fd1', '#171717'];

const meta = {
  title: 'Components/ColorPicker',
  component: ColorPicker,
} satisfies Meta<typeof ColorPicker>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function StatefulPicker({ initialSaved }: { initialSaved: string[] }) {
  const [color, setColor] = useState('#4473d3');
  const [saved, setSaved] = useState(initialSaved);
  const [open, setOpen] = useState(true);
  if (!open) return <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open the picker again</Button>;
  return <div className="gallery-stack" style={{ maxWidth: 300 }}>
    <ColorPicker value={color} onChange={setColor} presets={presets} saved={saved} labels={labels}
      onSave={hex => setSaved(current => current.includes(hex) ? current : [...current, hex])}
      onRemove={hex => setSaved(current => current.filter(item => item !== hex))}
      onClose={() => setOpen(false)} />
    <p className="gallery-note">Chosen: <code>{color}</code></p>
  </div>;
}

export const Default: Story = { render: () => <StatefulPicker initialSaved={['#e07a5f', '#3d405b']} /> };

export const NothingSavedYet: Story = { render: () => <StatefulPicker initialSaved={[]} /> };
