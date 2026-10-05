import { describe, expect, it } from 'vitest';
import {
  compareWithBaseline,
  countStylesheetHex,
  countUsage,
  readBaseline,
  scanRenderer,
  usageAdvice,
} from '../../scripts/ui-kit-usage';

describe('the renderer goes through the UI kit', () => {
  it('counts raw controls and title attributes on HTML elements only', () => {
    const source = `
      <Drawer title="Settings" onClose={() => value > 1 ? close() : undefined}>
        <button type="button" title={t('Xóa')} onClick={() => items.filter(item => item.count > 2)}>x</button>
        <span title="Path">{path}</span>
        <input type="checkbox" checked={on} />
        <input type="text" />
        <select><option>a</option></select>
        <Button title="Kit buttons are not raw">ok</Button>
      </Drawer>`;
    expect(countUsage(source)).toEqual({ rawButton: 1, rawSelect: 1, rawCheckbox: 1, titleAttribute: 2, hexColour: 0 });
  });

  it('does not take a title inside an expression for the element\'s own attribute', () => {
    const source = '<div onClick={() => open({ title: "x" })} data-label={<i title="inner" />}>y</div>';
    expect(countUsage(source).titleAttribute).toBe(0);
  });

  it('counts hex colours, and leaves token definitions out of a stylesheet\'s count', () => {
    expect(countUsage('const ink = "#1f1f1f"; const link = "#section";').hexColour).toBe(1);
    expect(countStylesheetHex(':root {\n  --text: #1f1f1f;\n}\n.note { color: #666; background: var(--bg); }')).toBe(1);
  });

  it('adds no raw control, title attribute or hex colour beyond the baseline', () => {
    const differences = compareWithBaseline(scanRenderer(), readBaseline());
    const added = differences.filter(difference => difference.current > difference.baseline);
    const removed = differences.filter(difference => difference.current < difference.baseline);
    const addedLines = added.map(difference => `${difference.file}: ${difference.baseline} -> ${difference.current}, ${usageAdvice[difference.kind]}`);
    expect(addedLines, 'See .agents/skills/orglet-ui/SKILL.md').toEqual([]);
    const removedLines = removed.map(difference => `${difference.file}: ${difference.kind} ${difference.baseline} -> ${difference.current}`);
    expect(removedLines, 'Fewer than the baseline: keep the gain with `node scripts/ui-kit-usage.ts --update`').toEqual([]);
  });
});
