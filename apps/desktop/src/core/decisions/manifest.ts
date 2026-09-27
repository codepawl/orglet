import { join } from 'node:path';
import type { PinnedFile } from './download';

/**
 * The files Tacet runs from on this computer, pinned by size and SHA-256 (COD-303). They are fetched from these
 * addresses only when the person turns Tacet on, and nothing else in the decisions code touches the network.
 *
 * The tokenizer is the one `codepawl/tacet-sonata` published at commit 10877b45 (the same file the Python package
 * loads). The ONNX file is exported from that commit's weights by `scripts/tacet/export_onnx.py`; it lives in the
 * repository's `onnx/` folder and is read from `main` until it is pinned to the commit that added it. A changed file
 * on `main` fails the hash check and is deleted, so the address can move without the app ever loading other bytes.
 */
const REPOSITORY = 'https://huggingface.co/codepawl/tacet-sonata/resolve';
const TOKENIZER_REVISION = '10877b45570dcd3e86f841e47c6dec49488037a2';
const ONNX_REVISION = 'main';

export const TACET_MODEL_NAME = 'tacet-sonata';

export type DecisionFiles = { model: PinnedFile; tokenizer: PinnedFile };

export const TACET_FILES: DecisionFiles = {
  model: {
    name: 'tacet-sonata-int8-embeddings.onnx',
    url: `${REPOSITORY}/${ONNX_REVISION}/onnx/tacet-sonata-int8-embeddings.onnx`,
    sha256: 'b97d02c18cfcb00d6648eb87a7836bb00577554819b71f5060c4aab015eb6589',
    bytes: 285_006_905,
  },
  tokenizer: {
    name: 'tokenizer.json',
    url: `${REPOSITORY}/${TOKENIZER_REVISION}/tokenizer/tokenizer.json`,
    sha256: '609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f',
    bytes: 34_363_188,
  },
};

/** What the whole download weighs, for the Settings block before anything starts. */
export function totalBytes(files: DecisionFiles): number {
  return files.model.bytes + files.tokenizer.bytes;
}

/** Tacet's folder under the app's data folder, beside the database. */
export function decisionsDirectory(dataDirectory: string): string {
  return join(dataDirectory, 'models', TACET_MODEL_NAME);
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * `ORGLET_TACET_SOURCE` points the download at a server on this computer, for the packaged smoke test. Only a loopback
 * address is taken, and the pinned sizes and hashes still apply, so it can change where identical bytes come from and
 * nothing else; any other value is ignored.
 */
export function filesFrom(source: string | undefined, files: DecisionFiles = TACET_FILES): DecisionFiles {
  if (!source) return files;
  let base: URL;
  try {
    base = new URL(source);
  } catch {
    return files;
  }
  if (base.protocol !== 'http:' || !LOOPBACK_HOSTS.has(base.hostname)) return files;
  const at = (file: PinnedFile): PinnedFile => ({ ...file, url: new URL(file.name, base.href.endsWith('/') ? base.href : `${base.href}/`).href });
  return { model: at(files.model), tokenizer: at(files.tokenizer) };
}
