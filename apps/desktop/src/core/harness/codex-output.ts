import { z } from 'zod';

// Codex structured output requires every property of every nested object to be
// required. A string envelope keeps the original Zod contract authoritative:
// the parsed payload is still validated by the runner before any result commits.
export const codexOutputSchema = {
  type: 'object', additionalProperties: false, required: ['payload'],
  properties: { payload: { type: 'string', description: 'JSON text for the requested Orglet answer object.' } },
} as const;

const Envelope = z.object({ payload: z.string().min(1) }).strict();

export function decodeCodexOutput(raw: unknown): unknown {
  const { payload } = Envelope.parse(raw);
  try { return JSON.parse(payload) as unknown; }
  catch { throw new Error('Codex trả payload không phải JSON hợp lệ.'); }
}
