/**
 * Measures the ONNX variants of Tacet in Node on this machine (COD-303): load time, CPU latency for a short and a long
 * request, and how far each variant's answers are from the Python package's on the parity fixtures.
 *
 *   node node_modules/esbuild/bin/esbuild scripts/tacet/bench.ts --bundle --platform=node --format=esm \
 *       --external:onnxruntime-node --outfile=scripts/tacet/.bench.mjs
 *   node scripts/tacet/.bench.mjs <folder with tacet-sonata-<variant>.onnx files> <tokenizer.json> [variant ...]
 *
 * The bundle sits beside this file, and is ignored by git, so it finds onnxruntime-node in the checkout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as ort from 'onnxruntime-node';
import { decodeAnswers } from '../../apps/desktop/src/core/decisions/decoding';
import { INTRA_OP_THREADS } from '../../apps/desktop/src/core/decisions/engine';
import { packRequest, tensorsOf, type PackedRequest } from '../../apps/desktop/src/core/decisions/packing';
import { tacetTokenizer } from '../../apps/desktop/src/core/decisions/tokenizer';
import { DecisionQuestions, type DecisionAnswer, type JsonValue } from '../../apps/desktop/src/shared/decisions';

type ParityCase = { name: string; state: JsonValue; questions: unknown; tokenIds: number[]; answers: Record<string, DecisionAnswer> };

const [modelFolder, tokenizerPath, ...requested] = process.argv.slice(2);
const variants = requested.length ? requested : ['fp32', 'int8', 'fp16'];
const parity = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'tacet', 'parity.json'), 'utf8')) as { maxLength: number; cases: ParityCase[] };

function feeds(packed: PackedRequest): Record<string, ort.Tensor> {
  const tensors = tensorsOf(packed);
  const sequence = [1, tensors.sequenceLength];
  const options = [1, tensors.questionCount, tensors.optionCount];
  return {
    input_ids: new ort.Tensor('int64', tensors.inputIds, sequence),
    attention_mask: new ort.Tensor('int64', tensors.attentionMask, sequence),
    segment_ids: new ort.Tensor('int64', tensors.segmentIds, sequence),
    marker_positions: new ort.Tensor('int64', tensors.markerPositions, options),
    marker_mask: new ort.Tensor('bool', tensors.markerMask, options),
  };
}

function percentile(samples: number[], fraction: number): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))];
}

function probabilitiesOf(answer: DecisionAnswer): number[] {
  if (answer.type === 'noul') return [answer.noul];
  return Object.values(answer.probabilities);
}

async function main() {
  let started = performance.now();
  const tokenizerJson = JSON.parse(readFileSync(tokenizerPath, 'utf8'));
  const tokenizer = tacetTokenizer(tokenizerJson);
  console.log(`tokenizer load ${(performance.now() - started).toFixed(0)} ms, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`);

  let tokenMismatches = 0;
  const packedCases = parity.cases.map(parityCase => {
    const packed = packRequest(tokenizer, parityCase.state, DecisionQuestions.parse(parityCase.questions), parity.maxLength);
    if (JSON.stringify(packed.tokenIds) !== JSON.stringify(parityCase.tokenIds)) tokenMismatches++;
    return { parityCase, packed };
  });
  console.log(`full tokenizer: ${parity.cases.length - tokenMismatches}/${parity.cases.length} cases pack to the Python token ids`);

  const short = packedCases.find(item => item.parityCase.name === 'noul-en')!.packed;
  const longCase = parity.cases.find(parityCase => parityCase.name === 'long-state')!;
  const long = packedCases.find(item => item.parityCase.name === 'long-state')!.packed;
  const medium = packRequest(tokenizer, longCase.state, DecisionQuestions.parse(longCase.questions), 512);
  console.log(`short request ${short.tokenIds.length} tokens, medium ${medium.tokenIds.length}, long ${long.tokenIds.length}`);

  for (const variant of variants) {
    const rssBefore = process.memoryUsage().rss;
    started = performance.now();
    const session = await ort.InferenceSession.create(join(modelFolder, `tacet-sonata-${variant}.onnx`), {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: INTRA_OP_THREADS,
      interOpNumThreads: 1,
    });
    const loadMs = performance.now() - started;
    const rssAfter = process.memoryUsage().rss;

    let worst = 0;
    let flipped = 0;
    for (const { parityCase, packed } of packedCases) {
      const tensors = tensorsOf(packed);
      const output = await session.run(feeds(packed));
      const answers = decodeAnswers(output.logits.data as Float32Array, tensors.optionCount, packed);
      for (const [questionId, expected] of Object.entries(parityCase.answers)) {
        const actual = answers[questionId];
        const difference = Math.max(...probabilitiesOf(expected).map((value, index) => Math.abs(value - probabilitiesOf(actual)[index])));
        worst = Math.max(worst, difference);
        const expectedPick = expected.type === 'choice' ? expected.choice : expected.type === 'noul' ? expected.noul >= 0.5 : Math.round(expected.score);
        const actualPick = actual.type === 'choice' ? actual.choice : actual.type === 'noul' ? actual.noul >= 0.5 : Math.round(actual.score);
        if (expectedPick !== actualPick) flipped++;
      }
    }

    const timings: Record<string, number[]> = { short: [], medium: [], long: [] };
    for (const [label, packed] of [['short', short], ['medium', medium], ['long', long]] as const) {
      for (let warmup = 0; warmup < 3; warmup++) await session.run(feeds(packed));
      const repeats = label === 'short' ? 40 : label === 'medium' ? 20 : 10;
      for (let index = 0; index < repeats; index++) {
        const begin = performance.now();
        await session.run(feeds(packed));
        timings[label].push(performance.now() - begin);
      }
    }
    console.log([
      `${variant}: load ${loadMs.toFixed(0)} ms, +${((rssAfter - rssBefore) / 1e6).toFixed(0)} MB RSS`,
      `short p50 ${percentile(timings.short, 0.5).toFixed(1)} ms p95 ${percentile(timings.short, 0.95).toFixed(1)} ms`,
      `512 p50 ${percentile(timings.medium, 0.5).toFixed(1)} ms p95 ${percentile(timings.medium, 0.95).toFixed(1)} ms`,
      `long p50 ${percentile(timings.long, 0.5).toFixed(1)} ms p95 ${percentile(timings.long, 0.95).toFixed(1)} ms`,
      `worst probability difference vs Python ${worst.toFixed(4)}, answers flipped ${flipped}`,
    ].join(' | '));
    await session.release();
  }
}

await main();
