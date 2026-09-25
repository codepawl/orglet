import { FACE_HEIGHT, FACE_WIDTH, FRAME_MILLISECONDS, renderFace, WAITING_FRAMES } from './faces';
import { ANSI, muted, truncate, type ColorMode } from './terminal';

/**
 * The face that waits with you (COD-236): the orglet's big face drawn in place, blinking and glancing, with what it is
 * doing and the seconds so far beside it. A terminal has no layout to show the shape of an answer, so a live face is
 * the waiting state here. `stop` erases it and leaves the cursor where the face started.
 */

export type WaitingOptions = {
  write: (text: string) => void;
  color: string;
  mode: ColorMode;
  /** For example "Researcher is working". */
  label: string;
  hint?: string;
  columns: () => number;
  frameMilliseconds?: number;
  now?: () => number;
};

/** Anything that shows a wait and takes it away again. */
export type Waiting = { start: () => void; stop: () => void };

export const NO_WAITING: Waiting = { start: () => undefined, stop: () => undefined };

const TEXT_GAP = '   ';

export class WaitingFace implements Waiting {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private drawn = false;
  private startedAt = 0;

  constructor(private readonly options: WaitingOptions) {}

  start(): void {
    const now = this.options.now ?? Date.now;
    this.startedAt = now();
    this.options.write(ANSI.hideCursor);
    this.draw();
    this.timer = setInterval(() => this.tick(), this.options.frameMilliseconds ?? FRAME_MILLISECONDS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.drawn) this.options.write(`\r${ANSI.up(FACE_HEIGHT - 1)}${ANSI.clearBelow}`);
    this.drawn = false;
    this.options.write(ANSI.showCursor);
  }

  private tick(): void {
    this.frameIndex = (this.frameIndex + 1) % WAITING_FRAMES.length;
    this.draw();
  }

  private elapsedSeconds(): number {
    const now = this.options.now ?? Date.now;
    return Math.floor((now() - this.startedAt) / 1000);
  }

  /** The text beside each face row: the label with the seconds on the middle row, the hint under it. */
  private besideRows(): string[] {
    const room = Math.max(0, this.options.columns() - FACE_WIDTH - TEXT_GAP.length - 1);
    const status = truncate(`${this.options.label} · ${this.elapsedSeconds()}s`, room);
    const hint = truncate(this.options.hint ?? '', room);
    return ['', '', muted(status, this.options.mode), muted(hint, this.options.mode), ''];
  }

  private draw(): void {
    const frame = WAITING_FRAMES[this.frameIndex];
    const faceRows = renderFace(this.options.color, frame, this.options.mode);
    const beside = this.besideRows();
    const rows = faceRows.map((row, index) => (beside[index] ? `${row}${TEXT_GAP}${beside[index]}` : row));
    const moveBack = this.drawn ? `\r${ANSI.up(FACE_HEIGHT - 1)}` : '';
    this.options.write(moveBack + rows.map(row => `${ANSI.clearLine}${row}`).join('\r\n'));
    this.drawn = true;
  }
}

/** A terminal without colour: one line that says who is working, taken away when the answer comes. */
export class WaitingLine implements Waiting {
  constructor(private readonly write: (text: string) => void, private readonly text: string) {}

  start(): void {
    this.write(this.text);
  }

  stop(): void {
    this.write(`\r${ANSI.clearLine}`);
  }
}
