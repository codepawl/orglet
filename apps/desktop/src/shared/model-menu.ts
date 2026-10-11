import type { ModelChoice } from './modelChoices';

/** The model menu on the prompt bar numbers its first rows 1 to 9, so one key chooses each. */
export const MODEL_MENU_NUMBERED_ROWS = 9;

/**
 * Which model rows the menu holds. The main list has the current models; the side panel, opened from the More models
 * row, has the older ones. `checkedInSidePanel` is true when the checked model is one of those, in which case the main
 * list still shows it as a row of its own so the menu says which model is current.
 */
export function modelMenuRows(choices: readonly ModelChoice[], checkedValue: string): {
  main: ModelChoice[];
  sidePanel: ModelChoice[];
  checkedInSidePanel: boolean;
} {
  const main = choices.filter(choice => !choice.more);
  const sidePanel = choices.filter(choice => choice.more);
  const checkedInSidePanel = sidePanel.some(choice => choice.value === checkedValue);
  return { main, sidePanel, checkedInSidePanel };
}

/** The index of the main-list row a pressed key chooses (1 is the first row), or undefined when it chooses none. */
export function numberedRowIndex(key: string, rowCount: number): number | undefined {
  if (!/^[1-9]$/.test(key)) return undefined;
  const index = Number(key) - 1;
  const lastNumbered = Math.min(rowCount, MODEL_MENU_NUMBERED_ROWS);
  return index < lastNumbered ? index : undefined;
}

/** The side panel opens to the right of the menu when it fits there, else to the left. */
export function sidePanelSide(input: { menuRight: number; panelWidth: number; windowWidth: number; edge: number }): 'right' | 'left' {
  const fitsRight = input.menuRight + input.panelWidth + input.edge <= input.windowWidth;
  return fitsRight ? 'right' : 'left';
}
