import { describe, expect, it } from 'vitest';
import { maskEmail, maskEmailsIn } from '../../apps/desktop/src/shared/pii';

describe('email addresses on screen', () => {
  it('keeps the first two letters and the domain', () => {
    expect(maskEmail('an.nguyen@example.com')).toBe('an•••@example.com');
    expect(maskEmail('nxan2911@gmail.com')).toBe('nx•••@gmail.com');
  });

  it('shows one letter of a name of two letters or fewer, so nothing short comes back whole', () => {
    expect(maskEmail('ab@example.com')).toBe('a•••@example.com');
    expect(maskEmail('a@example.com')).toBe('a•••@example.com');
  });

  it('leaves text that is not an address alone', () => {
    expect(maskEmail('Logged in')).toBe('Logged in');
    expect(maskEmail('@example.com')).toBe('@example.com');
    expect(maskEmail('a@b@c.com')).toBe('a@b@c.com');
  });

  it('masks every address inside a longer line a command-line tool printed', () => {
    expect(maskEmailsIn('Logged in using ChatGPT (an.nguyen@example.com)')).toBe('Logged in using ChatGPT (an•••@example.com)');
    expect(maskEmailsIn('work@company.io and home@gmail.com')).toBe('wo•••@company.io and ho•••@gmail.com');
    expect(maskEmailsIn('Sign in with claude.ai')).toBe('Sign in with claude.ai');
  });
});
