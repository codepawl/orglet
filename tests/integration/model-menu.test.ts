import { describe, expect, it } from 'vitest';
import { modelChoices } from '../../apps/desktop/src/shared/modelChoices';
import { MODEL_MENU_NUMBERED_ROWS, modelMenuRows, numberedRowIndex, sidePanelSide } from '../../apps/desktop/src/shared/model-menu';
import type { ModelEntry } from '../../apps/desktop/src/shared/models';

const codexList: ModelEntry[] = [
  { provider: 'codex', id: 'gpt-6-astra', displayName: 'GPT-6-Astra', isDefault: true, source: 'native' },
  { provider: 'codex', id: 'gpt-6-sol', displayName: 'GPT-6-Sol', source: 'native' },
  { provider: 'codex', id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', source: 'native' },
  { provider: 'codex', id: 'gpt-5.5', displayName: 'GPT-5.5', replacementId: 'gpt-5.6-sol', source: 'native' },
];

describe('the model menu on the prompt bar', () => {
  it('keeps the current models in the main list and the older ones in the side panel', () => {
    const choices = modelChoices('codex', codexList, true);
    const rows = modelMenuRows(choices, '');
    expect(rows.main.map(choice => choice.label)).toEqual(['GPT-6-Astra', 'GPT-6-Sol']);
    expect(rows.sidePanel.map(choice => choice.label)).toEqual(['GPT-5.6-Sol', 'GPT-5.5']);
    expect(rows.checkedInSidePanel).toBe(false);
  });

  it('says when the checked model lives in the side panel, so the main list can still show it', () => {
    const choices = modelChoices('codex', codexList, true);
    expect(modelMenuRows(choices, 'gpt-5.5').checkedInSidePanel).toBe(true);
    expect(modelMenuRows(choices, 'gpt-6-sol').checkedInSidePanel).toBe(false);
  });

  it('has no side panel when every model is current', () => {
    const choices = modelChoices('codex', codexList.slice(0, 2), true);
    expect(modelMenuRows(choices, '').sidePanel).toEqual([]);
  });

  it('maps the keys 1 to 9 onto the rows of the main list and nothing else', () => {
    expect(numberedRowIndex('1', 3)).toBe(0);
    expect(numberedRowIndex('3', 3)).toBe(2);
    expect(numberedRowIndex('4', 3)).toBeUndefined();
    expect(numberedRowIndex('0', 3)).toBeUndefined();
    expect(numberedRowIndex('a', 3)).toBeUndefined();
    expect(numberedRowIndex('12', 3)).toBeUndefined();
    expect(MODEL_MENU_NUMBERED_ROWS).toBe(9);
    expect(numberedRowIndex('9', 12)).toBe(8);
  });

  it('opens the side panel to the right when it fits there, else to the left', () => {
    expect(sidePanelSide({ menuRight: 600, panelWidth: 240, windowWidth: 1200, edge: 12 })).toBe('right');
    expect(sidePanelSide({ menuRight: 1100, panelWidth: 240, windowWidth: 1200, edge: 12 })).toBe('left');
    expect(sidePanelSide({ menuRight: 948, panelWidth: 240, windowWidth: 1200, edge: 12 })).toBe('right');
    expect(sidePanelSide({ menuRight: 949, panelWidth: 240, windowWidth: 1200, edge: 12 })).toBe('left');
  });
});
