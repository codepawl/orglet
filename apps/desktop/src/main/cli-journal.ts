import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StoredJournalRow, TerminalJournalRow, type TerminalNotice, type TerminalUndo } from '../shared/terminal-access';

/**
 * "What the terminal did" (docs/cli-held-actions-design.md): one line per elevated operation, in the data folder, local
 * only: not synced and not part of a backup. A row says what was done in words and where, never an argument that is a
 * secret; stage D keeps that rule by passing only the words in.
 */

export const TERMINAL_JOURNAL_FILE = 'terminal-journal.jsonl';
/** Older rows are dropped past this many, so the file stays small. */
export const MAX_JOURNAL_ROWS = 500;

export type JournalEntry = Omit<TerminalJournalRow, 'id' | 'at' | 'undoable' | 'undoneAt'> & {
  /** How Settings can take the grant back; absent when the core cannot. */
  undo?: TerminalUndo;
  /** A grant or a secret also raises a notice in the window's list when it is recorded. */
  notice?: boolean;
};

export class CliJournal {
  private readonly file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(userData: string, private readonly now: () => Date = () => new Date(), private readonly onNotice?: (notice: TerminalNotice) => void) {
    this.file = join(userData, TERMINAL_JOURNAL_FILE);
  }

  /** Rows are written one after another, so two operations at once never interleave a line. */
  record(entry: JournalEntry): Promise<void> {
    const { notice, undo, ...fields } = entry;
    const row = StoredJournalRow.parse({ id: randomUUID(), at: this.now().toISOString(), ...fields, ...(undo ? { undo, undoable: true } : {}) });
    this.writing = this.writing.then(() => this.append(row)).catch(() => undefined);
    if (notice) this.onNotice?.({ id: row.id, operation: row.operation, ...(row.subject ? { subject: row.subject } : {}) });
    return this.writing;
  }

  private async append(row: StoredJournalRow): Promise<void> {
    await appendFile(this.file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
    const rows = await this.readRows();
    if (rows.length > MAX_JOURNAL_ROWS) await this.writeRows(rows.slice(-MAX_JOURNAL_ROWS));
  }

  private async writeRows(rows: readonly StoredJournalRow[]): Promise<void> {
    await writeFile(this.file, rows.map(item => `${JSON.stringify(item)}\n`).join(''), { encoding: 'utf8', mode: 0o600 });
  }

  private async readRows(): Promise<StoredJournalRow[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const rows: StoredJournalRow[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = StoredJournalRow.safeParse(JSON.parse(line));
        if (parsed.success) rows.push(parsed.data);
      } catch {
        // A line cut short by a crash is skipped.
      }
    }
    return rows;
  }

  /** Newest first. The undo recipe stays in the file; the window only learns that a row can be undone. */
  async list(limit = MAX_JOURNAL_ROWS): Promise<TerminalJournalRow[]> {
    await this.writing;
    const rows = await this.readRows();
    return rows.slice(-limit).reverse().map(({ undo: _undo, ...row }) => row);
  }

  /** The recipe of a row that can still be undone. */
  async undoOf(rowId: string): Promise<TerminalUndo | undefined> {
    await this.writing;
    const row = (await this.readRows()).find(item => item.id === rowId);
    return row && !row.undoneAt ? row.undo : undefined;
  }

  /** Marks a row undone, so Undo runs once. */
  markUndone(rowId: string): Promise<void> {
    this.writing = this.writing.then(async () => {
      const rows = await this.readRows();
      await this.writeRows(rows.map(row => row.id === rowId ? { ...row, undoneAt: this.now().toISOString(), undoable: false } : row));
    }).catch(() => undefined);
    return this.writing;
  }
}
