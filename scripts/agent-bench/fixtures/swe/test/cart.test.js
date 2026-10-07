import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';

test('adds every line', () => {
  assert.equal(cartTotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);
});

test('applies a percentage discount', () => {
  assert.equal(cartTotal([{ price: 100, quantity: 1 }], 10), 90);
});
