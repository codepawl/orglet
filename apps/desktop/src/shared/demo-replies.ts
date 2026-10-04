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
