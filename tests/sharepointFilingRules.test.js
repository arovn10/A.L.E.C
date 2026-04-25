/**
 * tests/sharepointFilingRules.test.js
 *
 * Tests the document classification logic in config/sharepointFilingRules.js.
 * Pure logic — no network calls, no mocks needed.
 */

const { matchRule, listRules, CAMPUS_RENTALS, ABODINGO } = require('../config/sharepointFilingRules');

describe('sharepointFilingRules', () => {
  describe('listRules()', () => {
    it('returns an array of rules with required fields', () => {
      const rules = listRules();
      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThan(5);
      for (const rule of rules) {
        expect(rule).toHaveProperty('name');
        expect(rule).toHaveProperty('site');
        expect(rule).toHaveProperty('library');
        expect(rule).toHaveProperty('folder');
      }
    });
  });

  describe('matchRule()', () => {
    const year = new Date().getFullYear().toString();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');

    it('routes lease files to Campus Rentals / Leases', () => {
      const rule = matchRule('lease-agreement-2026.pdf', 'New lease for 123 Main St');
      expect(rule.site).toBe(CAMPUS_RENTALS);
      expect(rule.library).toBe('Leases');
      expect(rule.folder).toContain(year);
    });

    it('routes rental applications to Campus Rentals / Applications', () => {
      const rule = matchRule('rental-application.pdf', 'Application from John Doe');
      expect(rule.site).toBe(CAMPUS_RENTALS);
      expect(rule.library).toBe('Applications');
    });

    it('routes Abodingo invoices to Abodingo / Finance', () => {
      const rule = matchRule('invoice_001.pdf', 'Abodingo invoice for April');
      expect(rule.site).toBe(ABODINGO);
      expect(rule.library).toBe('Finance');
      expect(rule.folder).toContain('Invoices');
    });

    it('routes generic invoices to Campus Rentals / Finance when no Abodingo in subject', () => {
      const rule = matchRule('invoice_xyz.pdf', 'Maintenance invoice for Unit 4');
      expect(rule.site).toBe(CAMPUS_RENTALS);
      expect(rule.library).toBe('Finance');
    });

    it('routes insurance docs to Abodingo / Insurance', () => {
      const rule = matchRule('coi-2026.pdf', 'Certificate of Insurance renewal');
      expect(rule.site).toBe(ABODINGO);
      expect(rule.library).toBe('Insurance');
    });

    it('routes legal docs to Abodingo / Legal', () => {
      const rule = matchRule('eviction-notice.pdf', 'Legal eviction notice Unit 7');
      expect(rule.site).toBe(ABODINGO);
      expect(rule.library).toBe('Legal');
    });

    it('routes maintenance reports to Campus Rentals / Maintenance', () => {
      const rule = matchRule('maintenance-report-april.pdf', 'Work order complete');
      expect(rule.site).toBe(CAMPUS_RENTALS);
      expect(rule.library).toBe('Maintenance');
    });

    it('resolves YYYY and MM tokens in folder path', () => {
      const rule = matchRule('invoice_123.pdf', 'Abodingo April invoice');
      expect(rule.folder).toContain(year);
      expect(rule.folder).toContain(month);
    });

    it('returns a catch-all rule for unrecognized files', () => {
      const rule = matchRule('random-file.pdf', 'Some random email');
      expect(rule).not.toBeNull();
      expect(rule.name).toBe('General Document');
    });

    it('never returns null (catch-all always matches)', () => {
      const result = matchRule('', '');
      expect(result).not.toBeNull();
    });
  });
});
