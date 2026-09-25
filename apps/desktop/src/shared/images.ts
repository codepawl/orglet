import { z } from 'zod';

/**
 * Image types a model can be shown. OpenAI, Anthropic and the OpenAI-compatible servers all take these four; SVG and
 * BMP still attach and preview, but are never sent to a model (COD-260).
 */
export const ViewableImageMime = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export type ViewableImageMime = z.infer<typeof ViewableImageMime>;

/**
 * An image a message carries, named by the SHA-256 of its bytes. Checkpoints and tool results keep only this
 * reference; the bytes are read again, through the same permission, revoke and hash checks, right before each request.
 * Attached images use it now, and browser screenshots (COD-261) are meant to use the same slot.
 */
export const ImageRef = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  mime: ViewableImageMime,
}).strict();
export type ImageRef = z.infer<typeof ImageRef>;

/**
 * The largest image sent to a model. Base64 makes it about 6.7 MB, under the Claude API's 10 MB per image, and every
 * step resends it, so the limit also keeps each request small. Every connection is held to it.
 */
export const IMAGE_SEND_LIMIT = 5 * 1024 * 1024;

/**
 * What one image counts as, in input tokens, in the amount held before a paid request. Providers count an image by its
 * pixels after scaling it down. Anthropic's largest is 4,784 tokens; OpenAI's patch models stay under 3,800 and its tile
 * models under 1,500 at the default detail (both vendors' vision guides, read 2026-09-26). The charge itself settles
 * from the usage the provider reports.
 */
export const IMAGE_TOKEN_ALLOWANCE = 5_000;

/**
 * gpt-4o-mini prices image tokens low and counts many of them: 2,833 plus 5,667 per 512-pixel tile, up to 48,169 for
 * one image at the default detail. Its images are held at this instead.
 */
const GPT_4O_MINI_IMAGE_ALLOWANCE = 50_000;

/** The token allowance for one image sent to `modelId`, also through OpenRouter (`openai/gpt-4o-mini`). */
export function imageTokenAllowance(modelId: string | undefined): number {
  if (modelId?.toLowerCase().includes('gpt-4o-mini')) return GPT_4O_MINI_IMAGE_ALLOWANCE;
  return IMAGE_TOKEN_ALLOWANCE;
}

/** How many images a list of messages carries, for the amount held before a request. */
export function imageCount(messages: readonly { images?: readonly unknown[] }[]): number {
  let count = 0;
  for (const message of messages) count += message.images?.length ?? 0;
  return count;
}
