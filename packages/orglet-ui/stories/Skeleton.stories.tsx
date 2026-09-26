import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton, SkeletonGroup, SkeletonText } from '../src';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shapes: Story = {
  render: () => <SkeletonGroup label="Loading shapes">
    <div className="gallery-row">
      <Skeleton shape="circle" width={32} height={32} />
      <Skeleton shape="line" width={180} />
      <Skeleton shape="block" width={120} height={72} />
    </div>
  </SkeletonGroup>,
};

export const Text: Story = {
  render: () => <SkeletonGroup label="Loading the answer">
    <div style={{ maxWidth: 420 }}><SkeletonText lines={4} /></div>
  </SkeletonGroup>,
};

/** A list of rows on its way: a face, a name, a line of detail, each row starting its shimmer a beat later. */
export const ListOfRows: Story = {
  render: () => <SkeletonGroup label="Loading orglets">
    <div className="gallery-stack" style={{ maxWidth: 360 }}>
      {[0, 1, 2].map(row => <div key={row} className="gallery-row" style={{ flexWrap: 'nowrap' }}>
        <Skeleton shape="circle" width={32} height={32} delay={row * 0.1} />
        <div style={{ display: 'grid', gap: 6, flex: 1 }}>
          <Skeleton width="40%" delay={row * 0.1} />
          <Skeleton width="75%" delay={row * 0.1 + 0.05} />
        </div>
      </div>)}
    </div>
  </SkeletonGroup>,
};
