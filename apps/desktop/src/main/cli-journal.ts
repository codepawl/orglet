import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TerminalJournalRow } from '../shared/terminal-access';

/**
 * "What the terminal did" (docs/cli-held-actions-design.md): one line per elevated operation, in the data folder, local
 * only: not synced and not part of a backup. A row says what was done in words and where, never an argument that is a
 * secret; stage D keeps that rule by passing only the words in.
 */

export const TERMINAL_JOURNAL_FILE = 'terminal-journal.jsonl';
/** Older rows are dropped past this many, so the file stays small. */
export const MAX_JOURNAL_ROWS = 500;

export type JournalEntry = Omit<TerminalJournalRow, 'id' | 'at'>;

export class CliJournal {
  private readonly file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(userData: string, private readonly now: () => Date = () => new Date()) {
    this.file = join(userData, TERMINAL_JOURNAL_FILE);
  }

  /** Rows are written one after another, so two operations at once never interleave a line. */
  record(entry: JournalEntry): Promise<void> {
    const row = TerminalJournalRow.parse({ id: randomUUID(), at: this.now().toISOString(), ...entry });
    this.writing = this.writing.then(() => this.append(row)).catch(() => undefined);
    return this.writing;
  }

  private async append(row: TerminalJournalRow): Promise<void> {
    await appendFile(this.file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
    const rows = await this.readRows();
    if (rows.length > MAX_JOURNAL_ROWS) {
      const kept = rows.slice(-MAX_JOURNAL_ROWS);
      await writeFile(this.file, kept.map(item => `${JSON.stringify(item)}\n`).join(''), { encoding: 'utf8', mode: 0o600 });
    }
  }

  private async readRows(): Promise<TerminalJournalRow[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const rows: TerminalJournalRow[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = TerminalJournalRow.safeParse(JSON.parse(line));
        if (parsed.success) rows.push(parsed.data);
      } catch {
        // A line cut short by a crash is skipped.
      }
    }
    return rows;
  }

  /** Newest first. */
  async list(limit = MAX_JOURNAL_ROWS): Promise<TerminalJournalRow[]> {
    await this.writing;
    const rows = await this.readRows();
    return rows.slice(-limit).reverse();
  }
}
