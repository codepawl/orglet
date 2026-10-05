import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge, Button, Card } from '../src';

const meta: Meta<typeof Card> = {
  title: 'Components/Card',
  component: Card,
  args: { title: 'Weekly report', description: 'Sent every Monday morning', children: 'Summarises last week\'s finished chats and files.' },
  decorators: [Story => <div className="gallery-stack"><Story /></div>],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {};

export const WithActions: Story = {
  args: { actions: <Button type="button" variant="outline">Edit</Button> },
};

export const TitleOnly: Story = { args: { description: undefined, children: undefined } };

export const BodyOnly: Story = { args: { title: undefined, description: undefined } };

/** The whole card is one button, named by its title. */
export const Interactive: Story = {
  args: { interactive: true, onClick: () => undefined, title: 'Open the report', description: 'Last run 2 hours ago', children: <Badge tone="success">Passed</Badge> },
};
