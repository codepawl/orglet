import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { SmilePlus } from 'lucide-react';
import { userEvent, within } from 'storybook/test';
import { ReactionBadges, ReactionBar, ReactionPicker, type ReactionBadge, type ReactionOption } from '../src';

type Reaction = 'like' | 'love' | 'laugh' | 'wow' | 'sad';

const reactions: ReactionOption<Reaction>[] = [
  { name: 'like', emoji: '👍', meaning: 'Like' },
  { name: 'love', emoji: '❤️', meaning: 'Love' },
  { name: 'laugh', emoji: '😂', meaning: 'Laugh' },
  { name: 'wow', emoji: '😮', meaning: 'Wow' },
  { name: 'sad', emoji: '😢', meaning: 'Sad' },
];

const meta = {
  title: 'Components/Reactions',
  component: ReactionBar,
} satisfies Meta<typeof ReactionBar>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function StatefulBar() {
  const [picked, setPicked] = useState<Reaction | undefined>('love');
  return <div className="gallery-stack" style={{ paddingTop: 56 }}>
    <ReactionBar options={reactions} picked={picked} label="React" icon={<SmilePlus size={16} aria-hidden />}
      onPick={name => setPicked(current => current === name ? undefined : name)} />
    <p className="gallery-note">Picked: {picked ?? 'nothing'}</p>
  </div>;
}

/** The trigger opens a floating row above it; the reaction already left shows pressed. */
export const Bar: Story = {
  name: 'ReactionBar',
  render: () => <StatefulBar />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'React' }));
  },
};

export const Picker: Story = {
  name: 'ReactionPicker',
  render: () => <ReactionPicker options={reactions} picked="laugh" label="React" onPick={() => {}} />,
};

function badgesFor(counts: Partial<Record<Reaction, number>>, mine?: Reaction): ReactionBadge<Reaction>[] {
  return reactions
    .filter(option => counts[option.name])
    .map(option => ({
      name: option.name,
      emoji: option.emoji,
      count: counts[option.name] ?? 0,
      mine: option.name === mine,
      label: `${option.meaning}: ${counts[option.name]}`,
    }));
}

/** On a bubble's corner: `start` for the person's own message on the right, `end` for an answer. */
export const Badges: Story = {
  name: 'ReactionBadges',
  render: () => <div className="gallery-stack" style={{ maxWidth: 520 }}>
    <div className="gallery-bubble">
      The report is ready. Three numbers moved more than ten percent.
      <ReactionBadges align="end" badges={badgesFor({ like: 2, love: 1 }, 'like')} onPick={() => {}} />
    </div>
    <div className="gallery-bubble gallery-bubble-own">
      Thanks, send it to the crew.
      <ReactionBadges align="start" badges={badgesFor({ laugh: 1 })} onPick={() => {}} />
    </div>
    <ReactionBadges align="inline" badges={badgesFor({ like: 3, wow: 1, sad: 2 }, 'wow')} onPick={() => {}} />
  </div>,
};
