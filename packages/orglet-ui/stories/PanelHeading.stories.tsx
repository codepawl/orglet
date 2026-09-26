import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { Button, PanelHeading } from '../src';

const meta = {
  title: 'Components/PanelHeading',
  component: PanelHeading,
  args: { title: 'Connections', description: 'The accounts and keys your orglets can use.' },
  decorators: [Story => <div style={{ maxWidth: 640 }}><Story /></div>],
} satisfies Meta<typeof PanelHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithActions: Story = {
  args: { children: <Button type="button" variant="outline"><Plus size={16} aria-hidden /> Add</Button> },
};

export const TitleOnly: Story = { args: { description: undefined } };

export const LevelThree: Story = {
  args: { level: 3, title: 'Schedules', description: 'Runs that start on their own.' },
};
