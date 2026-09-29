/** How much of a helper process's error output is kept: enough for its last lines, never the whole stream. */
const KEPT_CHARACTERS = 4_000;
const SHOWN_LINES = 3;
const SHOWN_CHARACTERS = 400;

/** The last part of a stream that arrives in chunks, so a chatty process cannot grow it without bound. */
export class OutputTail {
  private text = '';

  add(chunk: string | Buffer) {
    this.text = (this.text + chunk.toString()).slice(-KEPT_CHARACTERS);
  }

  /**
   * The last few non-empty lines, joined on one line for an error message, with `hidden` (a scratch folder, say)
   * cut out. Empty when the process printed nothing.
   */
  lastLines(hidden: readonly string[] = []): string {
    let text = this.text;
    for (const value of hidden) {
      if (value) text = text.split(value).join('…');
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-SHOWN_LINES);
    const joined = lines.join(' · ');
    return joined.length > SHOWN_CHARACTERS ? `…${joined.slice(-SHOWN_CHARACTERS)}` : joined;
  }
}

/**
 * What the person reads when the data checker's process ended without an answer: the plain stop, or, when it printed
 * an error on the way out, that error's last lines (COD-292), so a crash is not mistaken for a cancel.
 */
export function checkerStoppedMessage(errorTail: string): string {
  if (!errorTail) return 'Checker đã dừng hoặc bị hủy. Không có kết quả được xác nhận.';
  return `Checker dừng giữa chừng, không có kết quả. Lỗi cuối cùng nó in ra: ${errorTail}`;
}
