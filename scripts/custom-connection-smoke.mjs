import { _electron as electron } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { packagedExecutable } from './packaged-executable.mjs';

// Custom OpenAI-compatible connections (COD-242), end to end in the packaged app, against a fake server this script
// starts on loopback:
// - a local connection is free: the orglet answers two messages in a row without waiting for budget;
// - a connection with a price entered settles a known charge from the reported tokens;
// - a remote connection without a price is labelled "Price unknown".
// Screenshots of the form, the list, the model list and the chat go to test-results/.

const FAKE_KEY = 'fixture-smoke-key-not-real-0123';
const CHAT_MODEL = 'smoke-chat-1';
const ANSWER = 'Hello from the fake OpenAI-compatible server';
const PROMPT_TOKENS = 120;
const COMPLETION_TOKENS = 18;
// $0.40 in and $1.60 out per million tokens, typed in the form in USD (the default display currency).
const PRICED_CHARGE_MICROS = Math.ceil((PROMPT_TOKENS * 400_000 + COMPLETION_TOKENS * 1_600_000) / 1_000_000);
const received = [];
let answers = 0;
/** Popovers and menus fade in over a few frames; a screenshot waits for them to settle. */
const settle = page => page.waitForTimeout(400);
/** Text that must stay on one line, by name, with the lines it rendered on and whether an ellipsis cut it. */
const measured = {};

/** How many lines an element's text really takes: the distinct tops of its text rectangles. */
async function measure(name, locator) {
  const result = await locator.evaluate(element => {
    // Text only: an icon beside the words has a box of its own a pixel or two off the text's top.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0));
    }
    // A new line starts where a rectangle begins below the middle of the line before it.
    rects.sort((first, second) => first.top - second.top);
    let lines = 0;
    let lineMiddle = -Infinity;
    for (const rect of rects) {
      if (rect.top > lineMiddle) {
        lines++;
        lineMiddle = rect.top + rect.height / 2;
      }
    }
    return { lines, truncated: element.scrollWidth > element.clientWidth + 1 };
  });
  measured[name] = result;
  assert.equal(result.lines, 1, `${name} fits on one line`);
}

/** Stands in for LM Studio: `/v1/models` and a streamed chat/completions that answers with the chat reply tool. */
function answer(request, response, body) {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [CHAT_MODEL, 'smoke-chat-2', 'text-embedding-smoke'].map(id => ({ id, object: 'model' })) }));
    return;
  }
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Not found' } }));
    return;
  }
  answers++;
  const message = `${ANSWER} (#${answers}).`;
  const toolNames = (body.tools ?? []).map(tool => tool.function?.name);
  const call = toolNames.includes('reply')
    ? { name: 'reply', arguments: JSON.stringify({ message, title: null, knowledgeProposals: [] }) }
    : { name: 'submit_report', arguments: JSON.stringify({ title: 'Hello', summary: message, findings: [], limitations: ['Smoke fixture.'] }) };
  const base = { id: 'smoke', object: 'chat.completion.chunk', created: 1, model: body.model };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_smoke', type: 'function', function: call }] }, finish_reason: 'tool_calls' }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: PROMPT_TOKENS, completion_tokens: COMPLETION_TOKENS, total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS } })}\n\n`);
  response.end('data: [DONE]\n\n');
}

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  const body = text ? JSON.parse(text) : {};
  received.push({ url: request.url, authorization: request.headers.authorization, model: body.model });
  answer(request, response, body);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/v1`;

const directory = await mkdtemp(join(tmpdir(), 'orglet-custom-connection-'));
const output = resolve('test-results');
await mkdir(output, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const app = await electron.launch({ executablePath: packagedExecutable(), args: [`--user-data-dir=${directory}`], env, timeout: 60_000 });

/** Opens Settings → API connections, adds one connection through the form, and waits for its row. */
async function addConnection(page, { name, url, key, inputPrice, outputPrice, screenshot, measureLabels = false }) {
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add connection' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Base URL').fill(url);
  if (key) await form.getByLabel('API key').fill(key);
  if (inputPrice) await form.getByLabel(/^Input price/).fill(inputPrice);
  if (outputPrice) await form.getByLabel(/^Output price/).fill(outputPrice);
  if (measureLabels) {
    await settle(page);
    await measure('input price label', form.locator('.org-field-label', { hasText: 'Input price' }));
    await measure('output price label', form.locator('.org-field-label', { hasText: 'Output price' }));
  }
  if (screenshot) {
    await settle(page);
    await page.screenshot({ path: join(output, screenshot) });
  }
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await form.waitFor({ state: 'hidden' });
  return page.getByRole('region', { name });
}

/** Gives the Researcher orglet one connection and its first chat model, through the orglet editor. */
async function giveResearcher(page, connectionName, screenshot) {
  await page.getByRole('button', { name: 'Options for Researcher', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const model = page.getByRole('combobox', { name: 'Model', exact: true });
  await model.click();
  await page.getByRole('option', { name: new RegExp(`^${connectionName.replace(/[()]/g, '\\$&')}`) }).click();
  const modelId = page.getByRole('combobox', { name: 'Model ID' });
  const chatOption = page.getByRole('option', { name: new RegExp(`^${CHAT_MODEL}`) });
  // The list opens once the connection's /models has answered; until then the field only takes a typed ID.
  await modelId.click();
  for (let attempt = 0; attempt < 50 && !(await chatOption.isVisible()); attempt++) {
    await modelId.press('ArrowDown');
    await page.waitForTimeout(200);
  }
  await chatOption.waitFor();
  if (screenshot) {
    const listed = await page.getByRole('listbox', { name: 'Model ID' }).getByRole('option').allTextContents();
    assert.ok(listed.some(text => text.includes('smoke-chat-2')), 'both chat models are listed');
    assert.equal(listed.some(text => text.includes('text-embedding-smoke')), false, 'embedding models stay hidden');
    await settle(page);
    await page.screenshot({ path: join(output, screenshot) });
  }
  await chatOption.click();
  await page.getByRole('button', { name: 'Save orglet', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}

/** Sends one message and waits for the numbered answer and for the chat to settle. */
async function send(page, text, answerNumber) {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText(`${ANSWER} (#${answerNumber}).`).waitFor({ timeout: 30_000 });
  await page.waitForFunction(async () => {
    const workspace = await window.orglet.call('workspace', {});
    return workspace.tasks.every(task => task.status !== 'running' && task.status !== 'queued' && task.status !== 'pausing');
  }, undefined, { timeout: 30_000 });
}

try {
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForFunction(() => window.orglet !== undefined);
  await page.getByRole('textbox', { name: 'Message' }).waitFor({ timeout: 30_000 });

  // Settings → API connections → Custom connections.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'API connections', exact: true }).click();

  // Plain http to a host on the internet is refused, and the form says why before anything is saved.
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const refusing = page.getByRole('dialog', { name: 'Add connection' });
  await refusing.getByLabel('Name').fill('Refused');
  await refusing.getByLabel('Base URL').fill('http://api.example.com/v1');
  await refusing.getByLabel('API key').click();
  await refusing.getByText('http:// is only for this computer or a private network.', { exact: false }).waitFor();
  await settle(page);
  await page.screenshot({ path: join(output, 'custom-connection-form-refused.png') });
  await refusing.getByRole('button', { name: 'Cancel', exact: true }).click();
  await refusing.waitFor({ state: 'hidden' });

  const local = await addConnection(page, { name: 'LM Studio (fake)', url: baseUrl, key: FAKE_KEY, screenshot: 'custom-connection-form.png' });
  await local.getByText('Local · free', { exact: false }).waitFor();
  const priced = await addConnection(page, { name: 'Hosted (priced)', url: `http://localhost:${port}/v1`, key: FAKE_KEY, inputPrice: '0.40', outputPrice: '1.60', screenshot: 'custom-connection-form-priced.png', measureLabels: true });
  await priced.getByText('$0.40 / $1.60 per 1M', { exact: false }).waitFor();
  const unknown = await addConnection(page, { name: 'Hosted (unknown)', url: 'https://api.example.com/v1' });
  await unknown.getByText('Price unknown', { exact: false }).waitFor();
  await unknown.scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: join(output, 'custom-connection-list.png') });
  await measure('section description', page.locator('.custom-connections .org-panel-heading-description'));
  for (const name of ['LM Studio (fake)', 'Hosted (priced)', 'Hosted (unknown)']) {
    await measure(`${name} meta line`, page.getByRole('region', { name }).locator('.custom-connection-meta'));
  }

  const workspace = await page.evaluate(() => window.orglet.call('workspace', {}));
  const connectionNamed = name => workspace.customConnections.find(item => item.name === name);
  const localConnection = connectionNamed('LM Studio (fake)');
  const pricedConnection = connectionNamed('Hosted (priced)');
  assert.equal(localConnection.baseUrl, baseUrl);
  assert.equal(localConnection.price, undefined, 'a local connection needs no price to be free');
  assert.deepEqual(pricedConnection.price, { inputMicrosPerMillion: 400_000, outputMicrosPerMillion: 1_600_000 });
  const keys = await page.evaluate(() => window.orglet.connections());
  assert.deepEqual(keys.custom, { [localConnection.id]: true, [pricedConnection.id]: true });
  assert.equal(JSON.stringify(keys).includes(FAKE_KEY), false, 'the window never gets the key back');
  assert.equal(JSON.stringify(workspace).includes(FAKE_KEY), false, 'the workspace never carries the key');
  await page.keyboard.press('Escape');

  // Free and local: two messages in a row, the second never waiting for budget.
  await giveResearcher(page, 'LM Studio (fake)', 'custom-connection-models.png');
  await send(page, 'Say hello through the custom connection', 1);
  await send(page, 'And once more, straight after', 2);
  await page.locator('.topbar-provider', { hasText: 'LM Studio (fake)' }).waitFor();
  await page.locator('.byline-provider', { hasText: 'LM Studio (fake)' }).first().waitFor();
  await page.screenshot({ path: join(output, 'custom-connection-chat.png') });
  const afterLocal = await page.evaluate(() => window.orglet.call('workspace', {}));
  assert.equal(afterLocal.usage.chargedMicros, 0);
  assert.equal(afterLocal.usage.reservedMicros, 0);
  assert.equal(afterLocal.usage.uncertainCount, 0);
  assert.equal(afterLocal.usage.inputTokens, 2 * PROMPT_TOKENS, 'tokens are still counted on a free connection');
  assert.deepEqual(afterLocal.budgetReservations, []);
  assert.ok(afterLocal.tasks.every(task => task.status === 'completed'), 'no chat waits for budget');

  // A price entered: the next message is held and settled at that price from the reported tokens.
  await giveResearcher(page, 'Hosted (priced)');
  await send(page, 'Now through the priced connection', 3);
  // The chat now spans two connections, so the header names neither; the new answer's byline names this one.
  await page.locator('.byline-provider', { hasText: 'Hosted (priced)' }).first().waitFor();
  await page.screenshot({ path: join(output, 'custom-connection-chat-priced.png') });
  const afterPriced = await page.evaluate(() => window.orglet.call('workspace', {}));
  assert.equal(afterPriced.usage.chargedMicros, PRICED_CHARGE_MICROS, 'a known charge settled at the entered price');
  assert.equal(afterPriced.usage.reservedMicros, 0);
  assert.equal(afterPriced.usage.uncertainCount, 0);
  assert.deepEqual(afterPriced.budgetReservations, []);

  const modelRequests = received.filter(item => item.url === '/v1/models');
  const chatRequests = received.filter(item => item.url === '/v1/chat/completions');
  assert.ok(modelRequests.length >= 2, 'each connection listed its models from the server');
  assert.equal(chatRequests.length, 3, 'three chat requests');
  assert.ok(chatRequests.every(item => item.model === CHAT_MODEL));
  assert.ok(received.every(item => item.authorization === `Bearer ${FAKE_KEY}`), 'every request carried the saved key');
  assert.deepEqual(errors, []);
  for (const [name, result] of Object.entries(measured)) console.log(`${name}: ${result.lines} line${result.truncated ? ', cut with an ellipsis' : ''}`);
  console.log(`Custom connection smoke passed: ${modelRequests.length} model list requests, ${chatRequests.length} chat requests, priced charge ${PRICED_CHARGE_MICROS} micros, screenshots in ${output}`);
} finally {
  await app.close();
  server.closeAllConnections();
  server.close();
}
