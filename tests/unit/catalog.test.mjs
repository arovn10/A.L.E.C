import { CATALOG } from '../../backend/connectors/catalog.mjs';

describe('connector catalog', () => {
  test('catalog has required connectors', () => {
    const ids = CATALOG.map(c => c.id);
    for (const id of ['github', 'microsoft365', 'tenantcloud', 'twilio', 'stoa', 'homeassistant', 'imessage', 'aws', 'render']) {
      expect(ids).toContain(id);
    }
  });

  test('every entry has fields array with {key,label,type,required,secret}', () => {
    for (const c of CATALOG) {
      expect(Array.isArray(c.fields)).toBe(true);
      for (const f of c.fields) {
        expect(typeof f.key).toBe('string');
        expect(typeof f.label).toBe('string');
        expect(['text', 'password', 'url', 'textarea', 'select']).toContain(f.type);
        expect(typeof f.required).toBe('boolean');
        expect(typeof f.secret).toBe('boolean');
      }
    }
  });
});
