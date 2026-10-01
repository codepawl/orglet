import { renderAnswers, renderTurns } from './pretty';
import type { CliAnswer, CliTurn } from './protocol';
import type { CliProgressFrame } from './protocol';
import { activityLines } from './activity';
import { truncate, wrapSegments, type ColorMode, type Style } from './terminal';

export type ActivityBlock = { kind: 'activity'; frame?: CliProgressFrame; following: boolean };
type Block = { kind: 'line'; text: string; style?: Style } | { kind: 'answers'; answers: readonly CliAnswer[]; note?: string } | { kind: 'turns'; turns: readonly CliTurn[] } | ActivityBlock;

/** Terminal-only history. The backend keeps the full conversation; this viewport never changes it. */
export class Transcript {
  private blocks: Block[] = [];
  expanded = false;
  offset = 0;
  /** Whether the last drawn view reached the top of what this transcript holds. */
  atTop = true;
  /** Earlier turns loaded from the app (COD-354): the oldest turn number shown, and whether the chat starts there. */
  earliestTurn: number | undefined;
  historyComplete = false;
  /** The first turn this terminal sent, so loading history starts before it instead of repeating it. */
  firstSentTurn: number | undefined;

  append(text: string, style?: Style): void {
    this.blocks.push({ kind: 'line', text, style });
    this.trim();
  }

  answer(answers: readonly CliAnswer[], note?: string): void {
    this.blocks.push({ kind: 'answers', answers, note });
    this.trim();
  }

  /** Puts earlier turns above everything shown, keeping the view where the person is reading. */
  prependTurns(turns: readonly CliTurn[], notice?: { text: string; style?: Style }): void {
    const blocks: Block[] = [];
    if (notice) blocks.push({ kind: 'line', text: notice.text, style: notice.style });
    if (turns.length) blocks.push({ kind: 'turns', turns }, { kind: 'line', text: '' });
    this.blocks.unshift(...blocks);
  }

  beginActivity(): ActivityBlock {
    const block: ActivityBlock = { kind: 'activity', following: true };
    this.blocks.push(block);
    this.trim();
    return block;
  }

  private trim(): void {
    // Only a bounded local view is kept; /read and the desktop retain the saved answers.
    if (this.blocks.length > 200) this.blocks.splice(0, this.blocks.length - 200);
    this.offset = 0;
  }

  clear(): void {
    this.blocks = [];
    this.offset = 0;
  }

  lines(width: number, mode: ColorMode, milliseconds = 0, reducedMotion = true): string[] {
    return this.blocks.flatMap(block => {
      if (block.kind === 'activity') {
        if (!block.frame) return [];
        const lines = activityLines(block.frame.steps, { width, mode, expanded: this.expanded, milliseconds, reducedMotion, following: block.following });
        if (block.frame.omitted) lines.unshift(truncate(`… ${block.frame.omitted} earlier steps omitted`, width));
        if (lines.length && !this.expanded && block.frame.steps.some(step => step.state !== 'running')) lines.push(mutedActivityHint(width));
        return [...lines, ...(lines.length ? [''] : [])];
      }
      if (block.kind === 'line') {
        if (block.style) return wrapSegments([{ text: block.text, style: block.style }], { width, mode });
        return [truncate(block.text, width)];
      }
      if (block.kind === 'turns') return renderTurns(block.turns, { width, mode, showFace: false });
      const synthesis = block.answers.filter(answer => answer.stage === 'synthesis');
      const answers = !this.expanded && synthesis.length ? synthesis : block.answers;
      const rendered = renderAnswers(answers, { width, mode, firstNote: block.note, showFace: false });
      if (this.expanded || rendered.length <= 9) return rendered;
      return [...rendered.slice(0, 7), truncate(`  … ${rendered.length - 7} more lines · Ctrl+O expands`, width)];
    });
  }

  view(height: number, width: number, mode: ColorMode, milliseconds = 0, reducedMotion = true): string[] {
    const lines = this.lines(width, mode, milliseconds, reducedMotion);
    while (lines.at(-1) === '') lines.pop();
    const highest = Math.max(0, lines.length - height);
    this.offset = Math.max(0, Math.min(this.offset, highest));
    this.atTop = this.offset >= highest;
    const end = lines.length - this.offset;
    return lines.slice(Math.max(0, end - height), end);
  }
}

function mutedActivityHint(width: number): string {
  return truncate('  Ctrl+O expands completed steps', width);
}
