/**
 * TokenManager — unit tests
 */

process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long-for-tests';

const { TokenManager } = require('../services/tokenManager');

describe('TokenManager', () => {
  let tm;

  beforeEach(() => {
    tm = new TokenManager();
  });

  test('generateToken returns expected fields', () => {
    const result = tm.generateToken('user-123', 'STOA_ACCESS', []);
    expect(result).toHaveProperty('token');
    expect(result).toHaveProperty('userId', 'user-123');
    expect(result).toHaveProperty('tokenType', 'STOA_ACCESS');
    expect(result).toHaveProperty('expiresAt');
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(20);
  });

  test('generateToken for FULL_CAPABILITIES includes permissions', () => {
    const result = tm.generateToken('user-456', 'FULL_CAPABILITIES', ['neural_training']);
    expect(result.tokenType).toBe('FULL_CAPABILITIES');
    expect(result.permissions).toContain('neural_training');
  });

  test('verifyToken succeeds for a freshly-generated token', () => {
    const { token } = tm.generateToken('user-789', 'STOA_ACCESS', []);
    const decoded = tm.verifyToken(token);
    expect(decoded).toHaveProperty('userId', 'user-789');
    expect(decoded).toHaveProperty('tokenType', 'STOA_ACCESS');
  });

  test('verifyToken throws for invalid input', () => {
    expect(() => tm.verifyToken('not.a.valid.jwt')).toThrow();
  });

  test('hasPermission returns true for included permission', () => {
    const { token } = tm.generateToken('u1', 'FULL_CAPABILITIES', ['admin', 'neural_training']);
    const decoded = tm.verifyToken(token);
    expect(tm.hasPermission(decoded, 'admin')).toBe(true);
  });

  test('hasPermission returns false for missing permission', () => {
    const { token } = tm.generateToken('u1', 'STOA_ACCESS', ['read']);
    const decoded = tm.verifyToken(token);
    expect(tm.hasPermission(decoded, 'neural_training')).toBe(false);
  });

  test('getPermissions returns correct scopes for STOA_ACCESS', () => {
    const perms = tm.getPermissions('STOA_ACCESS');
    expect(perms).toContain('stoa_data');
    expect(perms).toContain('basic_chat');
  });

  test('getPermissions returns full scope for FULL_CAPABILITIES', () => {
    const perms = tm.getPermissions('FULL_CAPABILITIES');
    expect(perms).toContain('neural_training');
    expect(perms).toContain('smart_home');
  });

  test('generateSecret returns 64-char hex string', () => {
    const secret = tm.generateSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(secret)).toBe(true);
  });
});
