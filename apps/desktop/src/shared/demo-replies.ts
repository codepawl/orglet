/**
 * Sample replies (owner, 2026-10-05: "drop the Demo model, use a real one"). An orglet whose provider is `demo` has no
 * model: the app shows it as not connected and refuses to run it. The sample replies that used to answer for it stay
 * only as a test tool, so the integration tests and the packaged smokes can run without a key. They are on when this
 * variable is `1`, which only the test setup and the smoke launcher set.
 */
export const DEMO_REPLIES_VARIABLE = 'ORGLET_DEMO_REPLIES';

/** What a run of an orglet with no model fails with, and what the window says before sending to one. */
export const MODEL_NOT_CONNECTED = 'Tí này chưa kết nối model. Kết nối một model rồi nhắn lại.';

/** True where sample replies stand in for a model: the tests and the packaged smokes. Never in an app a person runs. */
export function demoRepliesEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment[DEMO_REPLIES_VARIABLE] === '1';
}

/**
 * A sample answer with two charts, for the checks that draw charts in the chat (in-chat charts, 2026-10-07). It is
 * given only to a message that starts with `/demo-chart`, and only on Demo, which never reaches a person.
 */
export const DEMO_CHART_PROMPT = '/demo-chart';
export const DEMO_CHART_REPLY = [
  'Revenue grew every month, and the North region led the quarter.',
  '',
  '```chart',
  JSON.stringify({ type: 'line', title: 'Monthly revenue', takeaway: 'Revenue grew every month, from 12.4k to 21.9k.', columns: ['Month', 'Revenue', 'Costs'], rows: [['Jan', 12400, 9100], ['Feb', 13800, 9600], ['Mar', 15100, 10200], ['Apr', 17600, 10900], ['May', 19800, 11800], ['Jun', 21900, 12400]], x: 'Month', y: ['Revenue', 'Costs'], yLabel: 'USD', source: 'sales.csv' }),
  '```',
  '',
  '```chart',
  JSON.stringify({ type: 'bar', title: 'Revenue by region', takeaway: 'North brought in the most, South the least.', columns: ['Region', 'Revenue'], rows: [['North', 38200], ['East', 29100], ['West', 22400], ['South', 11000]], x: 'Region', y: ['Revenue'], yLabel: 'USD' }),
  '```',
].join('\n');
