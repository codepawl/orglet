import type { Meta, StoryObj } from '@storybook/react-vite';
import * as kit from '../src';
import { Button } from '../src';

type IconComponent = (props: kit.IconProps) => React.JSX.Element;

const icons = Object.entries(kit)
  .filter(([name]) => name.endsWith('Icon'))
  .map(([name, component]) => ({ name, Icon: component as IconComponent }));

const meta = {
  title: 'Foundations/Icons',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllIcons: Story = {
  render: () => <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 16 }}>
    {icons.map(({ name, Icon }) => <div key={name} style={{ display: 'grid', justifyItems: 'center', gap: 8 }}>
      <Icon size={24} />
      <span className="gallery-note">{name}</span>
    </div>)}
  </div>,
};

export const Sizes: Story = {
  render: () => <div className="gallery-row">
    {[14, 16, 20, 24].map(size => <kit.SearchIcon key={size} size={size} />)}
  </div>,
};

/** Pass `title` only when the icon stands alone, with no text beside it. */
export const WithATitle: Story = {
  render: () => <div className="gallery-row">
    <kit.SuccessIcon title="Saved" />
    <kit.AlertIcon title="Needs attention" size={20} />
    <kit.ErrorIcon title="Failed" size={24} />
  </div>,
};

export const InsideButtons: Story = {
  render: () => <div className="gallery-row">
    <Button type="button" variant="primary"><kit.PlusIcon /> New orglet</Button>
    <Button type="button" variant="outline"><kit.DownloadIcon /> Export</Button>
    <Button type="button" variant="danger"><kit.TrashIcon /> Delete</Button>
    <Button type="button" size="icon" aria-label="Settings"><kit.SettingsIcon /></Button>
    <Button type="button" size="icon" aria-label="More"><kit.MoreHorizontalIcon /></Button>
  </div>,
};
