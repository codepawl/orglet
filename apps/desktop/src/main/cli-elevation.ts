import { createHash, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { ElevationKey, PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH, type HeldBody } from '../cli/held-protocol';
import type { ElevationScope, TerminalAccessState } from '../shared/terminal-access';
import { CliFailure } from './cli-chats';

/**
 * Pairing and elevation for the held operations (docs/cli-held-actions-design.md). A terminal that wants to act for the
 * person asks for a code; the window shows it, the person types it at that terminal, and the terminal gets an
 * elevation key. Main keeps only the key's SHA-256. No Electron here and the clock and the random source are injected,
 * so tests drive every limit with a fake clock.
 */

export const PAIRING_LIFE_MS = 2 * 60_000;
export const MAX_WRONG_CODES = 5;
export const ELEVATION_LIFE_MS = 15 * 60_000;
export const ELEVATION_IDLE_MS = 5 * 60_000;
/** Three pairings that ended without a match inside ten minutes hold pairing for ten minutes. */
export const FAILED_PAIRINGS_BEFORE_HOLD = 3;
export const FAILED_PAIRING_WINDOW_MS = 10 * 60_000;
export const HOLD_MS = 10 * 60_000;

export const TERMINAL_ACCESS_OFF_MESSAGE = 'Cài đặt "Cho phép terminal làm thay tôi" đang tắt. Bật nó trong Cài đặt, Quyền riêng tư, nếu bạn muốn trả lời từ terminal.';

/** What a request that passed the elevation check carries to its operation, for the journal. */
export type ElevationGrant = { scope: ElevationScope };

/** The operation a `one` pairing is for: a hash of its exact arguments, and the words the dialog shows. */
export type PairingOperation = { hash: string; words: string };

export type CliElevationOptions = {
  /** The setting "Let a terminal act for me", read each time so turning it off takes effect at once. */
  isEnabled: () => Promise<boolean>;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  /** Called with the new state whenever a pairing, an elevation or the hold changes. */
  onChange?: (state: TerminalAccessState) => void;
};

type Pairing = { id: string; code: string; scope: ElevationScope; operation?: PairingOperation; expiresAt: number; wrongCodes: number };
type Elevation = { keyHash: Buffer; scope: ElevationScope; boundHash?: string; startedAt: number; lastUsedAt: number };

/** Sorted keys, so the same arguments always hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([first], [second]) => first < second ? -1 : 1);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The hash a `one` elevation is bound to: the operation and its exact arguments. */
export function operationHash(body: HeldBody): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function digestOf(text: string): Buffer {
  return createHash('sha256').update(text).digest();
}

function sameText(expected: string, given: string): boolean {
  return timingSafeEqual(digestOf(expected), digestOf(given));
}

/** What the person typed, without the spaces or hyphen they may have added to read the code in two halves. */
function normalizedCode(typed: string): string {
  return typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export class CliElevation {
  private pairing: Pairing | undefined;
  private elevation: Elevation | undefined;
  private failedPairings: number[] = [];
  private holdUntil = 0;

  constructor(private readonly options: CliElevationOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private random(size: number): Buffer {
    return (this.options.randomBytes ?? nodeRandomBytes)(size);
  }

  state(): TerminalAccessState {
    this.expire();
    return this.currentState();
  }

  private currentState(): TerminalAccessState {
    const now = this.now();
    const state: TerminalAccessState = {};
    if (this.pairing) {
      state.pairing = {
        code: this.pairing.code,
        scope: this.pairing.scope,
        ...(this.pairing.operation ? { operation: this.pairing.operation.words } : {}),
        expiresAt: new Date(this.pairing.expiresAt).toISOString(),
      };
    }
    if (this.elevation) {
      const endsAt = Math.min(this.elevation.startedAt + ELEVATION_LIFE_MS, this.elevation.lastUsedAt + ELEVATION_IDLE_MS);
      state.elevation = { scope: this.elevation.scope, endsAt: new Date(endsAt).toISOString() };
    }
    if (this.holdUntil > now) state.hold = { until: new Date(this.holdUntil).toISOString() };
    return state;
  }

  private emit(): void {
    this.options.onChange?.(this.currentState());
  }

  /** Lets time pass: a code that was not typed in time and an elevation that ran out or sat idle end here. */
  expire(): void {
    const now = this.now();
    let changed = false;
    if (this.pairing && now >= this.pairing.expiresAt) {
      this.pairing = undefined;
      this.recordFailedPairing();
      changed = true;
    }
    const elevation = this.elevation;
    if (elevation && (now - elevation.startedAt >= ELEVATION_LIFE_MS || now - elevation.lastUsedAt >= ELEVATION_IDLE_MS)) {
      this.elevation = undefined;
      changed = true;
    }
    if (this.holdUntil !== 0 && now >= this.holdUntil) {
      this.holdUntil = 0;
      changed = true;
    }
    if (changed) this.emit();
  }

  private recordFailedPairing(): void {
    const now = this.now();
    this.failedPairings = [...this.failedPairings.filter(at => now - at < FAILED_PAIRING_WINDOW_MS), now];
    if (this.failedPairings.length >= FAILED_PAIRINGS_BEFORE_HOLD) {
      this.holdUntil = now + HOLD_MS;
      this.failedPairings = [];
    }
  }

  private newCode(): string {
    const limit = 256 - (256 % PAIRING_CODE_ALPHABET.length);
    let code = '';
    while (code.length < PAIRING_CODE_LENGTH) {
      for (const byte of this.random(PAIRING_CODE_LENGTH * 2)) {
        if (byte < limit && code.length < PAIRING_CODE_LENGTH) code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
      }
    }
    return code;
  }

  async startPairing(scope: ElevationScope, operation?: PairingOperation): Promise<{ pairingId: string; expiresInSeconds: number }> {
    if (!await this.options.isEnabled()) throw new CliFailure('failed', TERMINAL_ACCESS_OFF_MESSAGE);
    this.expire();
    if (this.holdUntil > this.now()) {
      throw new CliFailure('failed', 'Terminal xin ghép đôi quá nhiều lần mà không nhập đúng mã nên bị tạm khóa. Thử lại sau ít phút.');
    }
    if (this.pairing) throw new CliFailure('busy', 'Đang có một yêu cầu ghép đôi khác. Hủy nó trong cửa sổ Orglet hoặc đợi mã hết hạn.');
    this.pairing = { id: this.random(16).toString('hex'), code: this.newCode(), scope, ...(operation ? { operation } : {}), expiresAt: this.now() + PAIRING_LIFE_MS, wrongCodes: 0 };
    const started = { pairingId: this.pairing.id, expiresInSeconds: PAIRING_LIFE_MS / 1000 };
    this.emit();
    return started;
  }

  /** Checks the typed code; a match returns the elevation key once, and main keeps only its hash. */
  finishPairing(pairingId: string, typedCode: string): { key: string; scope: ElevationScope; endsInSeconds: number } {
    this.expire();
    const pairing = this.pairing;
    if (!pairing || !sameText(pairing.id, pairingId)) throw new CliFailure('failed', 'Yêu cầu ghép đôi này đã hết hạn hoặc đã bị hủy. Chạy lại lệnh để lấy mã mới.');
    if (!sameText(pairing.code, normalizedCode(typedCode))) {
      pairing.wrongCodes += 1;
      if (pairing.wrongCodes >= MAX_WRONG_CODES) {
        this.pairing = undefined;
        this.recordFailedPairing();
        this.emit();
        throw new CliFailure('failed', 'Mã nhập sai quá nhiều lần nên đã bị hủy. Chạy lại lệnh để lấy mã mới.');
      }
      throw new CliFailure('invalid', `Mã không đúng. Còn ${MAX_WRONG_CODES - pairing.wrongCodes} lần thử.`);
    }
    const key = this.random(32).toString('hex');
    const now = this.now();
    // A new pairing ends the elevation before it.
    this.elevation = { keyHash: digestOf(key), scope: pairing.scope, ...(pairing.operation ? { boundHash: pairing.operation.hash } : {}), startedAt: now, lastUsedAt: now };
    this.pairing = undefined;
    this.emit();
    return { key, scope: this.elevation.scope, endsInSeconds: ELEVATION_LIFE_MS / 1000 };
  }

  /** Cancel in the window (no id) or from the terminal that asked. A cancelled pairing counts toward the hold. */
  cancelPairing(pairingId?: string): void {
    if (!this.pairing) return;
    if (pairingId !== undefined && !sameText(this.pairing.id, pairingId)) return;
    this.pairing = undefined;
    this.recordFailedPairing();
    this.emit();
  }

  /** End now, `/lock`, the setting turned off, or the app quitting. */
  endElevation(): void {
    if (!this.elevation && !this.pairing) return;
    this.elevation = undefined;
    this.pairing = undefined;
    this.emit();
  }

  /**
   * Called after the token check, before an elevated operation runs. `locked` when there is no live key that matches;
   * a `one` key is spent here, by the first operation that presents it with exactly the arguments it was made for.
   */
  async authorize(required: ElevationScope, key: unknown, boundHash: string): Promise<ElevationGrant> {
    if (!await this.options.isEnabled()) {
      this.endElevation();
      throw new CliFailure('failed', TERMINAL_ACCESS_OFF_MESSAGE);
    }
    this.expire();
    const current = this.elevation;
    const parsed = ElevationKey.safeParse(key);
    if (!current || !parsed.success || !timingSafeEqual(current.keyHash, digestOf(parsed.data))) {
      throw new CliFailure('locked', 'Lệnh này cần bạn mở khóa: nhập mã hiện trong cửa sổ Orglet. Gõ /unlock trong terminal chat, hoặc chạy lại lệnh ở một terminal.');
    }
    if (current.scope === 'one') {
      if (current.boundHash !== boundHash) throw new CliFailure('locked', 'Mã này chỉ cho phép đúng một thao tác khác. Chạy lại lệnh để lấy mã mới.');
      this.elevation = undefined;
      this.emit();
      return { scope: 'one' };
    }
    if (required === 'setup' && current.scope !== 'setup') {
      throw new CliFailure('locked', 'Việc này cần quyền rộng hơn. Gõ /unlock setup để mở khóa.');
    }
    current.lastUsedAt = this.now();
    this.emit();
    return { scope: current.scope };
  }
}
