import { CATALOG_HINT_IDS, type ModelListCache, type ModelListProvider } from '../../shared/models';
import type { HarnessId } from '../../shared/harness';

/**
 * OpenAI chat model families that take images, by ID prefix. OpenAI's model list says nothing about input types, so
 * this is the one place that knows. An ID outside it is treated as text-only, which only means the worker says it
 * cannot see the image; it never fails a request. Revalidate at https://developers.openai.com/api/docs/models before
 * a release.
 */
const OPENAI_IMAGE_FAMILIES = ['gpt-4o', 'chatgpt-4o', 'gpt-4.1', 'gpt-4.5', 'gpt-4-turbo', 'gpt-5', 'gpt-6', 'o1', 'o3', 'o4'];
/** Members of those families that take text (or sound) only. */
const OPENAI_TEXT_ONLY = ['o1-mini', 'o1-preview', 'o3-mini'];
const OPENAI_TEXT_ONLY_MARKERS = ['-audio', '-search', '-realtime', '-transcribe', '-tts'];

function openAIModelSeesImages(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (OPENAI_TEXT_ONLY.some(prefix => id.startsWith(prefix))) return false;
  if (OPENAI_TEXT_ONLY_MARKERS.some(marker => id.includes(marker))) return false;
  return OPENAI_IMAGE_FAMILIES.some(prefix => id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}.`));
}

/**
 * Whether an API connection's model is sent the images a worker opens (COD-260). Anthropic's Messages API takes images
 * on every model it serves. OpenAI goes by model family. xAI, OpenRouter and custom OpenAI-compatible connections go by
 * their own model list, when it says the model takes images; OpenRouter's catalog suggestion is known to. Ollama and
 * OpenCode lists say nothing about input types, so they get none. Local CLIs are decided per run path in the runner.
 */
export function modelSeesImages(provider: string, modelId: string | undefined, cache?: ModelListCache): boolean {
  if (provider === 'anthropic') return true;
  if (provider === 'openai') return openAIModelSeesImages(modelId || CATALOG_HINT_IDS.openai);
  if (!modelId) return false;
  const listed = cache?.byProvider[provider as ModelListProvider]?.models.find(entry => entry.id === modelId || entry.aliases?.includes(modelId));
  if (listed?.imageInput) return true;
  return provider === 'openrouter' && modelId === CATALOG_HINT_IDS.openrouter;
}

/**
 * Local CLIs that are handed images in a source-only answer: Claude Code opens its copy with its Read tool, and Codex
 * gets them attached to the prompt with `--image`. Cursor Agent and Gemini CLI get none (see docs/capabilities.md).
 */
export function harnessSeesImages(harness: HarnessId): boolean {
  return harness === 'claude-code' || harness === 'codex';
}
