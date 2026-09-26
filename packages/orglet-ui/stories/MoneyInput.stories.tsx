import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoneyInput } from '../src';

const meta = {
  title: 'Components/MoneyInput',
  component: MoneyInput,
} satisfies Meta<typeof MoneyInput>;

export default meta;
// Every story here renders its own stateful demo, so none of them passes args to the component.
type Story = StoryObj;

function Amount({ initial, symbol, code, invalid, title }: { initial: string; symbol: string; code: string; invalid?: boolean; title: string }) {
  const [value, setValue] = useState(initial);
  return <label className="gallery-label gallery-narrow">
    {title}
    <MoneyInput value={value} onChange={setValue} symbol={symbol} code={code} invalid={invalid} inputMode="decimal" />
  </label>;
}

export const Dollars: Story = { render: () => <Amount title="Budget per day" initial="5.00" symbol="$" code="USD" /> };

export const Dong: Story = { render: () => <Amount title="Ngân sách mỗi ngày" initial="120000" symbol="₫" code="VND" /> };

export const Invalid: Story = { render: () => <Amount title="Budget per day" initial="five" symbol="$" code="USD" invalid /> };

export const Disabled: Story = {
  render: () => <label className="gallery-label gallery-narrow">
    Budget per day
    <MoneyInput value="5.00" onChange={() => {}} symbol="$" code="USD" disabled />
  </label>,
};
