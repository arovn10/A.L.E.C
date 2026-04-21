import fs from 'node:fs';
import { setFields, getFields, deleteInstance, redact } from '../../backend/services/secretVault.mjs';

const TMP = '/tmp/vault-test.json';

beforeEach(() => {
  try { fs.unlinkSync(TMP); } catch {}
  process.env.ALEC_VAULT_PATH = TMP;
  process.env.ALEC_VAULT_KEY = 'a'.repeat(64); // 32 bytes hex → AES-256 key
});

afterAll(() => {
  try { fs.unlinkSync(TMP); } catch {}
});

test('round trip encrypt/decrypt', () => {
  setFields('uuid-1', { GITHUB_TOKEN: 'ghp_abc' });
  expect(getFields('uuid-1')).toEqual({ GITHUB_TOKEN: 'ghp_abc' });
});

test('delete wipes instance', () => {
  setFields('u', { K: 'v' });
  deleteInstance('u');
  expect(getFields('u')).toEqual({});
});

test('redact replaces secret fields with dots, leaves non-secret in the clear', () => {
  expect(redact({ K: 'v' }, [{ key: 'K', secret: true }])).toEqual({ K: '••••••••' });
  expect(redact({ K: 'v' }, [{ key: 'K', secret: false }])).toEqual({ K: 'v' });
});
