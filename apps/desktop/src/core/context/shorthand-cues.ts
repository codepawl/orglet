/*
 * How an orglet should read the person's shorthand (COD-368). The policy names the words people actually type, in
 * English and Vietnamese, so the model recognises them. The text is read by the model only and never shown, which is
 * why this file is listed in `scripts/i18n-keys.cjs` as matched, never shown.
 */

const TRAILING_LIST_CUES = ['"..."', '"etc."', '"v.v."', '"vân vân"'];
const EXAMPLE_CUES = ['"for example"', '"e.g."', '"such as"', '"ví dụ như"'];

export const SHORTHAND_POLICY = `Read shorthand the way the user means it: a list that trails off with ${TRAILING_LIST_CUES.join(', ')} names only the first few, so find and cover the rest of that kind instead of stopping at the ones listed; an example (${EXAMPLE_CUES.join(', ')}) shows the kind, shape, length and tone to follow, not text to reuse, so make your own in that pattern unless the user asks for that exact text.`;
