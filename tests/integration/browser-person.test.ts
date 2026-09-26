import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BrowserPerson, HOLDING_BROWSER } from '../../apps/desktop/src/core/tools/browser-person';
import { BrowserApprovalCard } from '../../apps/desktop/src/renderer/components/BrowserApproval';
import type { BrowserApprovalView } from '../../apps/desktop/src/shared/browser';

/*
 * Dogfood, 2026-09-26: while the person held the browser, the card asking about the orglet's next step still took
 * Allow, and the allowed step then acted on the page the person was using. The card now waits for the hand-back.
 */

const taskId = '11111111-1111-4111-8111-111111111111';
const view: BrowserApprovalView = {
  id: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333', actionId: '44444444-4444-4444-8444-444444444444',
  workerName: 'Researcher', kind: 'click', element: 'button “Place order”', site: 'shop.example.com', url: 'https://shop.example.com/cart',
  reasons: [], requestedAt: '2026-09-26T10:00:00.000Z',
};

describe('a card while the person holds the browser', () => {
  it('takes no answer until the browser is handed back, then takes it as before', async () => {
    const person = new BrowserPerson(() => {}, 60_000);
    const asked = person.ask(taskId, view, new AbortController().signal);
    person.takeOver(taskId);
    expect(() => person.answer(taskId, view.id, 'allow')).toThrow(HOLDING_BROWSER);
    expect(() => person.answer(taskId, view.id, 'decline')).toThrow(HOLDING_BROWSER);
    // The card is still there, waiting.
    expect(person.approval(taskId)?.id).toBe(view.id);
    person.handBack(taskId);
    person.answer(taskId, view.id, 'allow');
    await expect(asked).resolves.toBe('allow');
  });

  it('greys both answers out with the reason, and leaves them live otherwise', () => {
    const held = renderToStaticMarkup(createElement(BrowserApprovalCard, { taskId, approval: view, busy: false, held: true, onAnswer: () => {} }));
    expect(held).toContain('You have the browser. Hand it back, then answer.');
    expect(held.match(/<button[^>]*disabled=""[^>]*aria-describedby="browser-approval-held-/g)).toHaveLength(2);
    // In the chat, where nothing else offers it, the card hands the browser back itself.
    const inChat = renderToStaticMarkup(createElement(BrowserApprovalCard, { taskId, approval: view, busy: false, held: true, onHandBack: () => {}, onAnswer: () => {} }));
    expect(inChat).toMatch(/<button(?![^>]*disabled)[^>]*>.*?Hand back<\/button>/);
    expect(held).not.toContain('Hand back</button>');
    const free = renderToStaticMarkup(createElement(BrowserApprovalCard, { taskId, approval: view, busy: false, onAnswer: () => {} }));
    expect(free).not.toContain('Hand it back');
    expect(free).not.toMatch(/<button[^>]*disabled=""/);
  });
});
