import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { CommandBlock, Select } from '../src';

const meta = {
  title: 'Components/CommandBlock',
  component: CommandBlock,
  args: {
    command: 'npm install -g @anthropic-ai/claude-code',
    copyLabel: 'Copy command',
    onCopy: fn(),
  },
} satisfies Meta<typeof CommandBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = { args: { label: 'Run this in a terminal' } };

/** A long path in a narrow column breaks after a separator or a space, never inside a word. */
export const LongCommandInANarrowColumn: Story = {
  args: {
    label: 'Sign in again',
    command: 'C:\\Users\\someone\\AppData\\Local\\Programs\\orglet\\resources\\harness-accounts\\claude.exe login --profile work',
  },
  decorators: [Story => <div className="gallery-narrow"><Story /></div>],
};

const terminals = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'Command Prompt' },
  { value: 'bash', label: 'Git Bash' },
];

const commandsByTerminal: Record<string, string> = {
  powershell: '$env:ORGLET_HOME = "$HOME\\orglet"; orglet status',
  cmd: 'set ORGLET_HOME=%USERPROFILE%\\orglet && orglet status',
  bash: 'ORGLET_HOME="$HOME/orglet" orglet status',
};

/** A small control that changes the command sits on the card's top bar, left of the copy button. */
export const WithToolbar: Story = {
  render: args => {
    const [terminal, setTerminal] = useState('powershell');
    return <div style={{ maxWidth: 480 }}>
      <CommandBlock {...args} label="Check the connection" command={commandsByTerminal[terminal]}
        toolbar={<div style={{ width: 170 }}>
          <Select size="sm" ariaLabel="Terminal" value={terminal} options={terminals} onChange={setTerminal} />
        </div>} />
    </div>;
  },
};
