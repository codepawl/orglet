import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ModelReply } from '../../apps/desktop/src/core/adapters/openai';

export function isPlanRequest(tools?: ChatCompletionTool[]) {
  return Boolean(tools?.some(tool => tool.type === 'function' && tool.function.name === 'submit_plan'));
}

export function memberIdsFromPlanPrompt(messages: ChatCompletionMessageParam[]) {
  for (const message of messages) {
    if (typeof message.content !== 'string') continue;
    try {
      const parsed = JSON.parse(message.content) as { members?: { id: string }[] };
      if (Array.isArray(parsed.members) && parsed.members.length) return parsed.members.map(member => member.id);
    } catch { /* not the roster message */ }
  }
  throw new Error('Fixture plan missing member roster');
}

export function planReply(messages: ChatCompletionMessageParam[], pick?: (ids: string[]) => string[]): ModelReply {
  const ids = memberIdsFromPlanPrompt(messages);
  const chosen = pick ? pick(ids) : ids;
  return {
    calls: [{ id: 'plan', name: 'submit_plan', arguments: JSON.stringify({ assignments: chosen.map(workerId => ({ workerId, brief: 'Do your assigned role for this user message.' })) }) }],
    usage: { input: 50, output: 20 },
  };
}
