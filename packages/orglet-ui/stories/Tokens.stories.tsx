import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import tokensSource from '../src/styles/tokens.css?raw';
import { Button } from '../src';

/*
 * The tokens page is read from tokens.css itself, so it cannot drift from what the kit ships: a token added, renamed
 * or recoloured there shows up here on the next build. Swatches and samples use `var(--name)`, so they follow the
 * theme in the toolbar.
 */

type Token = { name: string; light: string; dark?: string; note?: string };
type Group = 'colour' | 'type' | 'shape' | 'motion';

/** The declarations inside the first block whose selector is exactly `selector`, with the comment just above each. */
function declarationsIn(source: string, selector: string) {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) return new Map<string, { value: string; note?: string }>();
  const body = source.slice(source.indexOf('{', start) + 1, source.indexOf('\n}', start));
  const declarations = new Map<string, { value: string; note?: string }>();
  const pattern = /(?:\/\*([\s\S]*?)\*\/\s*)?(--org-[\w-]+)\s*:\s*([^;]+);/g;
  for (const match of body.matchAll(pattern)) {
    const note = match[1]?.replace(/\s+/g, ' ').trim();
    declarations.set(match[2], { value: match[3].replace(/\s+/g, ' ').trim(), note });
  }
  return declarations;
}

function readTokens(source: string): Token[] {
  const light = declarationsIn(source, ':root');
  const dark = declarationsIn(source, ':root[data-theme=dark]');
  return Array.from(light, ([name, { value, note }]) => ({ name, light: value, dark: dark.get(name)?.value, note }));
}

function groupOf(name: string): Group {
  if (/font|line-height/.test(name)) return 'type';
  if (/motion|ease/.test(name)) return 'motion';
  if (/radius|height|width|size/.test(name)) return 'shape';
  return 'colour';
}

const tokens = readTokens(tokensSource);

const groups: { id: Group; title: string; description: string }[] = [
  { id: 'colour', title: 'Colour', description: 'Surfaces, text, the one strong colour, and the states. Dark values come from the dark block.' },
  { id: 'type', title: 'Type', description: 'The two families and the base size and line height.' },
  { id: 'shape', title: 'Radius and size', description: 'One control height keeps a row of mixed controls on one line.' },
  { id: 'motion', title: 'Motion', description: 'Durations and curves. Under reduced motion every duration is zero.' },
];

function Sample({ token, group, played }: { token: Token; group: Group; played: boolean }) {
  const reference = `var(${token.name})`;
  if (group === 'colour') return <span className="gallery-swatch" style={{ background: reference }} />;
  if (group === 'type') {
    if (token.name === '--org-font' || token.name === '--org-font-mono') {
      return <span className="gallery-type-sample" style={{ fontFamily: reference }}>Aa 123</span>;
    }
    return <span className="gallery-size-sample">{token.light}</span>;
  }
  if (group === 'shape') {
    if (token.name.includes('radius')) return <span className="gallery-radius-sample" style={{ borderRadius: reference }} />;
    // A control's height or an icon's box is drawn at its size; a panel's size is larger than the column, so only read.
    if (token.name.includes('panel')) return <span />;
    const square = token.name.includes('icon-size');
    return <span className="gallery-radius-sample" style={{ height: reference, width: square ? reference : 56, borderRadius: 'var(--org-radius)' }} />;
  }
  const isCurve = token.name.includes('ease');
  const transition = isCurve
    ? `transform var(--org-motion-gesture) ${reference}`
    : `transform ${reference} var(--org-ease-out)`;
  return <span className={played ? 'gallery-motion-track gallery-motion-played' : 'gallery-motion-track'}>
    <span className="gallery-motion-dot" style={{ transition }} />
  </span>;
}

function TokensPage() {
  const [played, setPlayed] = useState(false);
  return <div className="gallery-tokens">
    {groups.map(group => {
      const members = tokens.filter(token => groupOf(token.name) === group.id);
      return <section key={group.id} aria-labelledby={`tokens-${group.id}`}>
        <div className="gallery-row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 id={`tokens-${group.id}`}>{group.title}</h2>
            <p className="gallery-note">{group.description}</p>
          </div>
          {group.id === 'motion' && <Button type="button" variant="outline" onClick={() => setPlayed(value => !value)}>Play</Button>}
        </div>
        <ul className="gallery-token-list">
          {members.map(token => <li key={token.name} className="gallery-token" title={token.note}>
            <Sample token={token} group={group.id} played={played} />
            <span className="gallery-token-name">{token.name}</span>
            <span className="gallery-token-values">
              <span>{token.light}</span>
              {token.dark && <span>dark: {token.dark}</span>}
            </span>
          </li>)}
        </ul>
      </section>;
    })}
  </div>;
}

const meta = {
  title: 'Foundations/Tokens',
  component: TokensPage,
} satisfies Meta<typeof TokensPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tokens: Story = {};
