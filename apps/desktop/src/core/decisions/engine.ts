import { readFile } from 'node:fs/promises';
import type { DecisionQuestions, DecisionResponse, DecisionState } from '../../shared/decisions';
import { decodeAnswers, usageOf } from './decoding';
import { packRequest, tensorsOf, type PackingTokenizer } from './packing';
import { tacetTokenizer } from './tokenizer';

/**
 * Tacet itself: the tokenizer and an ONNX Runtime session on the CPU, answering one request per forward pass. It runs
 * inside the decisions worker thread (worker.ts), so loading 180 MB and a forward pass never hold up the core.
 */

type OnnxRuntime = typeof import('onnxruntime-node');

export type EngineFiles = { model: string; tokenizer: string };

/** ONNX Runtime threads for one forward pass: enough to be quick, never the whole machine the person is working on. */
export const INTRA_OP_THREADS = 2;

export class TacetEngine {
  private constructor(private runtime: OnnxRuntime, private session: import('onnxruntime-node').InferenceSession, private tokenizer: PackingTokenizer, readonly name: string) {}

  static async load(files: EngineFiles, name = 'tacet-sonata'): Promise<TacetEngine> {
    const runtime = await import('onnxruntime-node');
    const tokenizer = tacetTokenizer(JSON.parse(await readFile(files.tokenizer, 'utf8')));
    const session = await runtime.InferenceSession.create(files.model, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: INTRA_OP_THREADS,
      interOpNumThreads: 1,
    });
    return new TacetEngine(runtime, session, tokenizer, name);
  }

  async decide(state: DecisionState, questions: DecisionQuestions, maxLength: number): Promise<DecisionResponse> {
    const packed = packRequest(this.tokenizer, state, questions, maxLength);
    const tensors = tensorsOf(packed);
    const sequenceShape = [1, tensors.sequenceLength];
    const optionShape = [1, tensors.questionCount, tensors.optionCount];
    const { Tensor } = this.runtime;
    const output = await this.session.run({
      input_ids: new Tensor('int64', tensors.inputIds, sequenceShape),
      attention_mask: new Tensor('int64', tensors.attentionMask, sequenceShape),
      segment_ids: new Tensor('int64', tensors.segmentIds, sequenceShape),
      marker_positions: new Tensor('int64', tensors.markerPositions, optionShape),
      marker_mask: new Tensor('bool', tensors.markerMask, optionShape),
    });
    const logits = output.logits.data as Float32Array;
    return { model: this.name, answers: decodeAnswers(logits, tensors.optionCount, packed), usage: usageOf(packed) };
  }

  async close(): Promise<void> {
    await this.session.release();
  }
}
