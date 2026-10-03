import assert from 'node:assert/strict';
import { test } from 'node:test';
import { masterKeys, createAccountKey, unwrapAccountKey, rewrapAccountKey, encryptRow, decryptRow } from '../src/crypto.ts';

const first = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const second = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
const masters = await masterKeys(JSON.stringify({ active: 1, keys: { 1: first } }));

test('random account keys and nonces protect identical plaintext independently', async () => {
  const a = await createAccountKey('account-a', masters);
  const b = await createAccountKey('account-b', masters);
  assert.notEqual(a.wrapped.generation, b.wrapped.generation);
  assert.notDeepEqual(a.wrapped, b.wrapped);
  const context = ['account-a', a.wrapped.generation, 'setting:language', 1];
  const saved = await encryptRow(a.key, 'confidential text', context);
  const again = await encryptRow(a.key, 'confidential text', context);
  assert.notDeepEqual(saved, again);
  assert.equal(await decryptRow(await unwrapAccountKey('account-a', a.wrapped, masters), saved, context), 'confidential text');
  assert.equal(JSON.stringify(saved).includes('confidential text'), false);
  assert.equal(a.key.extractable, false);
});
test('account, generation, row and sequence are authenticated; tampering and cross-account wrapping fail', async () => {
  const a = await createAccountKey('account-a', masters);
  const context = ['account-a', a.wrapped.generation, 'setting:language', 1];
  const saved = await encryptRow(a.key, 'private', context);
  for (const changed of [['account-b', ...context.slice(1)], [context[0], crypto.randomUUID(), ...context.slice(2)],
    [...context.slice(0, 2), 'setting:theme', 1], [...context.slice(0, 3), 2]]) {
    await assert.rejects(decryptRow(a.key, saved, changed));
  }
  const body = Buffer.from(saved.body, 'base64'); body[0] ^= 1;
  await assert.rejects(decryptRow(a.key, { ...saved, body: body.toString('base64') }, context));
  await assert.rejects(unwrapAccountKey('account-b', a.wrapped, masters));
});
test('master rotation rewraps the same random data key without rewriting encrypted rows', async () => {
  const a = await createAccountKey('account-a', masters);
  const context = ['account-a', a.wrapped.generation, 'row', 1];
  const row = await encryptRow(a.key, 'retained', context);
  const rotation = await masterKeys(JSON.stringify({ active: 2, keys: { 1: first, 2: second } }));
  const wrapped = await rewrapAccountKey('account-a', a.wrapped, rotation);
  assert.equal(wrapped.generation, a.wrapped.generation);
  assert.equal(wrapped.version, 2);
  const onlyNew = await masterKeys(JSON.stringify({ active: 2, keys: { 2: second } }));
  assert.equal(await decryptRow(await unwrapAccountKey('account-a', wrapped, onlyNew), row, context), 'retained');
  await assert.rejects(unwrapAccountKey('account-a', a.wrapped, onlyNew));
});
test('invalid master configuration fails closed', async () => {
  for (const value of [{ active: 1, keys: {} }, { active: 2, keys: { 1: first } }, { active: 1, keys: { 1: 'bad' } },
    { active: 1, keys: { 1: first }, unexpected: true }, { active: 1, keys: { 1: Buffer.alloc(16).toString('base64') } }]) {
    await assert.rejects(masterKeys(JSON.stringify(value)));
  }
});
