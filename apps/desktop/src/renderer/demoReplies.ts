/**
 * Whether sample replies stand in for a model in this app (`shared/demo-replies.ts`): true only in tests and packaged
 * smokes. The workspace says so, and the window keeps the last answer here so that labels far from the workspace
 * (a provider's name, a permission's reason) can ask without it being passed down to each of them.
 */
import { DEMO_REPLIES_VARIABLE } from '../shared/demo-replies';

// The window has no process environment, so it starts off and waits for the workspace. A test that calls a window
// module directly has one, and reads the same variable the core does.
let enabled = typeof process !== 'undefined' && process.env?.[DEMO_REPLIES_VARIABLE] === '1';

export function setDemoReplies(value: boolean | undefined) {
  enabled = value === true;
}

export function demoReplies(): boolean {
  return enabled;
}
