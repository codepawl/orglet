import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chartFencesIn, chartProblemsIn, checkChart } from '../../apps/desktop/src/shared/charts';

/**
 * Live chart benchmark: real models answer chart requests with only the reply tool's chart guidance, and each answer is
 * scored the way the app reads it: a chart was sent, it passes the app's check first time, it is the form the job calls
 * for, and its numbers are the ones given. Gated on ORGLET_LIVE_KEY_FILE; prints the table and asserts nothing about
 * quality, so a weak model is a finding, not a red test.
 *   $env:ORGLET_LIVE_KEY_FILE = 'C:\path\to\key.txt'; node node_modules/vitest/vitest.mjs run tests/live/chart-replies.test.ts
 */
const keyFile = process.env.ORGLET_LIVE_KEY_FILE;
const models = (process.env.ORGLET_LIVE_CHART_MODELS ?? 'gpt-6-luna,gpt-6.1-sol').split(',');

/** The chart guidance exactly as the reply tool carries it, read from the catalog so the benchmark never drifts. */
function chartGuidance(): string {
  const source = readFileSync(new URL('../../apps/desktop/src/core/tools/catalog.ts', import.meta.url), 'utf8');
  const match = /const CHART_GUIDANCE = '((?:[^'\\]|\\.)*)';/.exec(source);
  if (!match) throw new Error('CHART_GUIDANCE not found in catalog.ts');
  return match[1].replace(/\\'/g, "'").trim();
}

type Case = { prompt: string; expected: string[]; numbers: number[] };
const CASES: Case[] = [
  { prompt: 'Monthly revenue in USD: Jan 12000, Feb 13500, Mar 12800, Apr 15100, May 16900, Jun 18200. How did it trend?', expected: ['line', 'area'], numbers: [12000, 18200] },
  { prompt: 'Sign-ups by country last week: Vietnam 420, Thailand 310, Indonesia 290, Philippines 180, Malaysia 150. Compare them.', expected: ['bar'], numbers: [420, 150] },
  { prompt: 'Our budget split: rent 40%, salaries 35%, tools 15%, marketing 10%. Show the parts of the whole.', expected: ['pie', 'bar'], numbers: [40, 10] },
  { prompt: 'Ad spend vs sales per campaign (spend, sales): (100, 900), (250, 1800), (400, 2600), (600, 3100), (800, 3300). Is there a relationship?', expected: ['scatter'], numbers: [100, 3300] },
  { prompt: 'Response times in ms from 30 requests: 120 135 128 142 150 160 118 125 131 139 145 152 170 210 260 129 133 141 147 155 162 175 190 230 300 124 138 144 158 166. Show the distribution.', expected: ['histogram'], numbers: [] },
  { prompt: 'Daily active users vs new users, Mon to Fri: DAU 1200 1250 1300 1280 1400, new 80 95 70 110 120. Plot both over the week.', expected: ['line', 'area', 'bar'], numbers: [1200, 120] },
  { prompt: 'Revenue (USD) and conversion rate (%) by month: Jan 12000 / 2.1, Feb 13500 / 2.4, Mar 12800 / 2.2. Chart them.', expected: ['line', 'bar', 'area'], numbers: [12000, 2.4] },
  { prompt: 'Average rating per app store category: Productivity 4.4, Games 4.1, Education 4.6, Finance 3.9, Health & Fitness 4.3, Photo & Video 4.0, Developer Tools 4.5. Compare.', expected: ['bar'], numbers: [4.6, 3.9] },
  { prompt: 'Quarterly users by plan, Q1 to Q4: Free 500 650 800 950, Pro 120 160 210 260, Team 30 45 70 90. Show how the mix grew.', expected: ['bar', 'area', 'line'], numbers: [950, 30] },
  { prompt: 'Doanh thu theo tuần (triệu đồng): tuần 1 45, tuần 2 52, tuần 3 49, tuần 4 61. Vẽ giúp mình.', expected: ['line', 'bar', 'area'], numbers: [45, 61] },
  { prompt: 'Error counts by service: auth 12, sync 48, market 7, accounts 3. Which one needs attention?', expected: ['bar'], numbers: [48, 3] },
  { prompt: 'Temperature (°C) over a day every 3 hours: 0h 24, 3h 23, 6h 25, 9h 29, 12h 33, 15h 34, 18h 30, 21h 27.', expected: ['line', 'area'], numbers: [23, 34] },
];

async function reply(key: string, model: string, instructions: string, prompt: string): Promise<{ text: string; milliseconds: number }> {
  const began = Date.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, instructions, input: prompt, max_output_tokens: 3000 }),
  });
  const body = await response.json() as { output_text?: string; output?: { content?: { type: string; text?: string }[] }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(`${model}: HTTP ${response.status} ${body.error?.message ?? ''}`);
  const text = body.output_text ?? (body.output ?? []).flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text ?? '').join('');
  return { text, milliseconds: Date.now() - began };
}

describe.skipIf(!keyFile)('chart replies, live', () => {
  it('answers chart requests with charts the app can draw', async () => {
    const key = readFileSync(keyFile!, 'utf8').trim();
    const instructions = `You are an orglet answering in a chat app. Your message is shown as Markdown.${chartGuidance().replace(/^Charts:/, ' Charts:')}`;
    const table: Record<string, unknown>[] = [];
    for (const model of models) {
      let sent = 0, valid = 0, rightForm = 0, numbersKept = 0, milliseconds = 0;
      const misses: string[] = [];
      for (const [index, item] of CASES.entries()) {
        const answer = await reply(key, model, instructions, item.prompt);
        milliseconds += answer.milliseconds;
        const fences = chartFencesIn(answer.text);
        if (!fences.length) { misses.push(`#${index + 1} no chart`); continue; }
        sent++;
        if (chartProblemsIn(answer.text).length) { misses.push(`#${index + 1} invalid: ${chartProblemsIn(answer.text)[0].slice(0, 80)}`); continue; }
        valid++;
        const checked = checkChart(fences[0]);
        const type = checked.ok ? checked.spec.type : 'none';
        if (item.expected.includes(type)) rightForm++; else misses.push(`#${index + 1} form ${type}, wanted ${item.expected.join('/')}`);
        // Two measures on different scales are two charts by the guidance, so the numbers are read from every chart sent.
        const allRows = fences.map(fence => checkChart(fence)).map(result => result.ok ? result.spec.rows : []);
        const values = new Set(JSON.stringify(allRows).match(/-?\d+(\.\d+)?/g)?.map(Number));
        if (item.numbers.every(number => values.has(number))) numbersKept++; else misses.push(`#${index + 1} numbers changed`);
      }
      table.push({ model, cases: CASES.length, sent, validFirstTime: valid, rightForm, numbersKept, averageSeconds: Math.round(milliseconds / CASES.length / 100) / 10, misses });
    }
    console.log('chart benchmark', JSON.stringify(table, null, 1));
    expect(table.length).toBe(models.length);
  }, 900_000);
});
