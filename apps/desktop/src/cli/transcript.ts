import { renderAnswers } from './pretty';
import type { CliAnswer } from './protocol';
import { truncate, wrapSegments, type ColorMode, type Style } from './terminal';

type Block = { kind: 'line'; text: string; style?: Style } | { kind: 'answers'; answers: readonly CliAnswer[]; note?: string };

/** Terminal-only history. The backend keeps the full conversation; this viewport never changes it. */
export class Transcript {
  private blocks: Block[] = [];
  expanded = false;
  offset = 0;

  append(text: string, style?: Style): void {
    this.blocks.push({ kind: 'line', text, style });
    this.trim();
  }

  answer(answers: readonly CliAnswer[], note?: string): void {
    this.blocks.push({ kind: 'answers', answers, note });
    this.trim();
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

  lines(width: number, mode: ColorMode): string[] {
    return this.blocks.flatMap(block => {
      if (block.kind === 'line') {
        if (block.style) return wrapSegments([{ text: block.text, style: block.style }], { width, mode });
        return [truncate(block.text, width)];
      }
      const synthesis = block.answers.filter(answer => answer.stage === 'synthesis');
      const answers = !this.expanded && synthesis.length ? synthesis : block.answers;
      const rendered = renderAnswers(answers, { width, mode, firstNote: block.note, showFace: false });
      if (this.expanded || rendered.length <= 9) return rendered;
      return [...rendered.slice(0, 7), truncate(`  … ${rendered.length - 7} more lines · Ctrl+O expands`, width)];
    });
  }

  view(height: number, width: number, mode: ColorMode): string[] {
    const lines = this.lines(width, mode);
    while (lines.at(-1) === '') lines.pop();
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, lines.length - height)));
    const end = lines.length - this.offset;
    return lines.slice(Math.max(0, end - height), end);
  }
}
