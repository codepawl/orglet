import { Tokenizer } from '@huggingface/tokenizers';
import type { PackingTokenizer } from './packing';

/**
 * Tacet's tokenizer (mmBERT's Gemma vocabulary: BPE with byte fallback, Metaspace, 256k tokens) read from the model's
 * own tokenizer.json by Hugging Face's tokenizers.js. The special tokens are the ones tokenizer_config.json names.
 */
export const TACET_SPECIAL_TOKENS = { cls: '<bos>', sep: '<eos>', mask: '<mask>', pad: '<pad>' } as const;

function requiredId(tokenizer: Tokenizer, token: string): number {
  const tokenId = tokenizer.token_to_id(token);
  if (tokenId === undefined) throw new Error(`Bộ tách từ của Tacet thiếu token ${token}.`);
  return tokenId;
}

type MetaspaceConfig = { type: 'Metaspace'; replacement: string; split?: boolean };

/**
 * tokenizers.js 0.2.0 ignores Metaspace's `split: true`: it keeps "▁a▁▁b" as one piece, where the Rust tokenizers the
 * model was trained with split it before every "▁" ("▁a", "▁", "▁b"). With one space between words the results agree,
 * but runs of spaces, tabs lined up with spaces or indented text come out as different tokens. The same split is
 * rebuilt here from the library's own pieces: Metaspace without the split, then a Split that cuts before each "▁".
 */
export function withMetaspaceSplit(tokenizerJson: Record<string, unknown>): Record<string, unknown> {
  const preTokenizer = tokenizerJson.pre_tokenizer as MetaspaceConfig | undefined;
  if (preTokenizer?.type !== 'Metaspace' || !preTokenizer.split) return tokenizerJson;
  const replacement = preTokenizer.replacement;
  return {
    ...tokenizerJson,
    pre_tokenizer: {
      type: 'Sequence',
      pretokenizers: [
        { ...preTokenizer, split: false },
        // With `invert`, the library keeps what the pattern matches: each "▁" with the text up to the next one.
        { type: 'Split', pattern: { Regex: `${replacement}[^${replacement}]*` }, behavior: 'MergedWithNext', invert: true },
      ],
    },
  };
}

export function tacetTokenizer(tokenizerJson: Record<string, unknown>): PackingTokenizer {
  const tokenizer = new Tokenizer(withMetaspaceSplit(tokenizerJson), {
    bos_token: TACET_SPECIAL_TOKENS.cls,
    eos_token: TACET_SPECIAL_TOKENS.sep,
    cls_token: TACET_SPECIAL_TOKENS.cls,
    sep_token: TACET_SPECIAL_TOKENS.sep,
    mask_token: TACET_SPECIAL_TOKENS.mask,
    pad_token: TACET_SPECIAL_TOKENS.pad,
    unk_token: '<unk>',
    clean_up_tokenization_spaces: false,
  });
  return {
    encode: text => tokenizer.encode(text, { add_special_tokens: false }).ids,
    maskToken: TACET_SPECIAL_TOKENS.mask,
    clsId: requiredId(tokenizer, TACET_SPECIAL_TOKENS.cls),
    sepId: requiredId(tokenizer, TACET_SPECIAL_TOKENS.sep),
    maskId: requiredId(tokenizer, TACET_SPECIAL_TOKENS.mask),
    padId: requiredId(tokenizer, TACET_SPECIAL_TOKENS.pad),
  };
}
