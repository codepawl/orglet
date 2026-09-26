import type { Meta, StoryObj } from '@storybook/react-vite';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { userEvent, within } from 'storybook/test';
import { Button, Toaster, showToast } from '../src';

const icons = {
  success: <CircleCheck size={16} aria-hidden />,
  error: <CircleAlert size={16} aria-hidden />,
  info: <Info size={16} aria-hidden />,
};

const meta = {
  title: 'Components/Toaster',
  component: Toaster,
  args: { icons },
  argTypes: { icons: { control: false } },
  parameters: { layout: 'fullscreen' },
  render: args => <div style={{ padding: 24, paddingTop: 200 }}>
    <div className="gallery-row">
      <Button type="button" variant="outline" onClick={() => showToast('Saved')}>Success</Button>
      <Button type="button" variant="outline" onClick={() => showToast('Could not reach the model. Check the connection.', 'error')}>Error</Button>
      <Button type="button" variant="outline" onClick={() => showToast('A new version is ready', 'info', { label: 'Restart', onSelect: () => showToast('Restarting…', 'info') })}>Info with an action</Button>
    </div>
    <Toaster {...args} />
  </div>,
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A plain success goes after 3 s, anything else after 6 s; at most three show at once. */
export const Tones: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Error' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Info with an action' }));
  },
};

export const Empty: Story = {};
