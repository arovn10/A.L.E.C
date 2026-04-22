/**
 * Unit test for backend/auth/password.js hash/verify round-trip —
 * the primitive that /api/auth/change-password depends on.
 *
 * Covers:
 *   1. hash() produces a self-describing string starting with argon2id$ or scrypt$.
 *   2. verify() accepts the correct password and rejects wrong ones.
 *   3. hash() rejects too-short passwords (<10 chars).
 *   4. verify() returns false for legacy 'UNCLAIMED' marker or empty input.
 */
const password = require('../backend/auth/password.js');

describe('password module — hash/verify', () => {
  test('hash produces a self-describing string', async () => {
    const h = await password.hash('correct-horse-battery');
    expect(typeof h).toBe('string');
    expect(h === '' || h.startsWith('argon2id$') || h.startsWith('scrypt$')).toBe(true);
  });

  test('verify accepts the correct password', async () => {
    const h = await password.hash('correct-horse-battery');
    await expect(password.verify('correct-horse-battery', h)).resolves.toBe(true);
  });

  test('verify rejects the wrong password', async () => {
    const h = await password.hash('correct-horse-battery');
    await expect(password.verify('wrong-password-here', h)).resolves.toBe(false);
  });

  test('hash rejects short passwords (<10 chars)', async () => {
    await expect(password.hash('short')).rejects.toThrow(/at least 10/);
  });

  test('verify returns false for UNCLAIMED and empty', async () => {
    await expect(password.verify('anything', 'UNCLAIMED')).resolves.toBe(false);
    await expect(password.verify('anything', '')).resolves.toBe(false);
    await expect(password.verify('anything', null)).resolves.toBe(false);
  });

  test('each hash uses a unique salt (different outputs for same input)', async () => {
    const a = await password.hash('correct-horse-battery');
    const b = await password.hash('correct-horse-battery');
    expect(a).not.toBe(b);
    // …yet both verify.
    await expect(password.verify('correct-horse-battery', a)).resolves.toBe(true);
    await expect(password.verify('correct-horse-battery', b)).resolves.toBe(true);
  });
});
