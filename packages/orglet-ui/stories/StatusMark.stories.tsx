import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, StatusMark, type StatusMarkTone, type StatusMarkVariant } from '../src';

const meta = {
  title: 'Components/StatusMark',
  component: StatusMark,
  args: { variant: 'filled', tone: 'success', label: 'New answer' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['empty', 'dashed', 'paused', 'filled', 'busy'] },
    tone: { control: 'inline-radio', options: ['muted', 'success', 'error', 'working'] },
  },
} satisfies Meta<typeof StatusMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

const variants: StatusMarkVariant[] = ['empty', 'dashed', 'paused', 'filled', 'busy'];
const tones: StatusMarkTone[] = ['muted', 'success', 'error', 'working'];

/** Every shape in every colour. Each state has its own shape, so colour is never the only difference. */
export const EveryState: Story = {
  render: () => <div className="gallery-status-grid">
    <span />
    {variants.map(variant => <span key={variant} className="gallery-status-heading">{variant}</span>)}
    {tones.map(tone => <div key={tone} style={{ display: 'contents' }}>
      <span>{tone}</span>
      {variants.map(variant => <StatusMark key={variant} variant={variant} tone={tone} label={`${variant}, ${tone}`} />)}
    </div>)}
  </div>,
};

/** The states an app actually shows, beside the titles they mark. */
export const BesideTitles: Story = {
  render: () => <div className="gallery-stack" style={{ gap: 8 }}>
    <div className="gallery-row"><StatusMark variant="empty" label="Idle" /> Researcher</div>
    <div className="gallery-row"><StatusMark variant="busy" tone="working" label="Working" /> Writer</div>
    <div className="gallery-row"><StatusMark variant="paused" label="Paused" /> Reviewer</div>
    <div className="gallery-row"><StatusMark variant="filled" tone="success" label="New answer" /> Analyst</div>
    <div className="gallery-row"><StatusMark variant="filled" tone="error" label="Needs you" /> Planner</div>
  </div>,
};

/** Inside a control that already has a name, the mark stays out of it. */
export const Decorative: Story = {
  render: () => <Button type="button" variant="outline"><StatusMark variant="busy" tone="working" label="Working" decorative /> Open Writer</Button>,
};
