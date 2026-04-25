/**
 * config/sharepointFilingRules.js
 *
 * Maps email attachment document types to the correct SharePoint site + library + folder.
 *
 * Site names are matched via SharePoint search (getSiteIdByName).
 * Library names are matched by substring (getLibraryIdByName).
 * Folder paths support YYYY/MM tokens resolved at filing time.
 *
 * Detection priority: the FIRST matching rule wins.
 * The `detect` function receives the file name (lowercased) and email subject (lowercased).
 */

const CAMPUS_RENTALS = 'Campus Rentals';
const ABODINGO       = 'Abodingo';

const rules = [
  // ── Leases ──────────────────────────────────────────────────────
  {
    name: 'Lease Agreement',
    site: CAMPUS_RENTALS,
    library: 'Leases',
    folder: 'YYYY',
    detect: (filename, subject) =>
      /lease|tenancy|rental.agreement/.test(filename) ||
      /lease|tenancy|rental.agreement/.test(subject),
  },
  {
    name: 'Lease Renewal',
    site: CAMPUS_RENTALS,
    library: 'Leases',
    folder: 'Renewals/YYYY',
    detect: (filename, subject) =>
      /renewal|renew/.test(filename) || /lease.renewal|renewal.notice/.test(subject),
  },

  // ── Applications ─────────────────────────────────────────────────
  {
    name: 'Rental Application',
    site: CAMPUS_RENTALS,
    library: 'Applications',
    folder: 'YYYY/MM',
    detect: (filename, subject) =>
      /application|applicant/.test(filename) ||
      /rental.application|apply/.test(subject),
  },

  // ── Invoices & Payments ──────────────────────────────────────────
  {
    name: 'Invoice (Abodingo)',
    site: ABODINGO,
    library: 'Finance',
    folder: 'Invoices/YYYY/MM',
    detect: (filename, subject) =>
      /invoice|inv\d|bill/.test(filename) && /abodingo/.test(subject),
  },
  {
    name: 'Invoice (Campus Rentals)',
    site: CAMPUS_RENTALS,
    library: 'Finance',
    folder: 'Invoices/YYYY/MM',
    detect: (filename, subject) =>
      /invoice|inv\d|bill/.test(filename),
  },

  // ── Contracts ────────────────────────────────────────────────────
  {
    name: 'Vendor Contract',
    site: ABODINGO,
    library: 'Contracts',
    folder: 'Vendors/YYYY',
    detect: (filename, subject) =>
      /contract|agreement|msa|sow|statement.of.work/.test(filename) ||
      /contract|vendor.agreement/.test(subject),
  },

  // ── Maintenance ──────────────────────────────────────────────────
  {
    name: 'Maintenance Report',
    site: CAMPUS_RENTALS,
    library: 'Maintenance',
    folder: 'YYYY/MM',
    detect: (filename, subject) =>
      /maintenance|work.order|repair|inspection/.test(filename) ||
      /maintenance|repair|inspection/.test(subject),
  },

  // ── Insurance ────────────────────────────────────────────────────
  {
    name: 'Insurance Document',
    site: ABODINGO,
    library: 'Insurance',
    folder: 'YYYY',
    detect: (filename, subject) =>
      /insurance|policy|coi|certificate.of.insurance/.test(filename) ||
      /insurance|policy|coi/.test(subject),
  },

  // ── Legal ─────────────────────────────────────────────────────────
  {
    name: 'Legal Document',
    site: ABODINGO,
    library: 'Legal',
    folder: 'YYYY',
    detect: (filename, subject) =>
      /legal|court|lawsuit|eviction|notice.to.vacate|ntv/.test(filename) ||
      /legal|court|lawsuit|eviction/.test(subject),
  },

  // ── Tax ──────────────────────────────────────────────────────────
  {
    name: 'Tax Document',
    site: ABODINGO,
    library: 'Finance',
    folder: 'Tax/YYYY',
    detect: (filename, subject) =>
      /tax|w-?9|1099|schedule.e|irs/.test(filename) ||
      /tax return|irs|1099/.test(subject),
  },

  // ── Catch-all ─────────────────────────────────────────────────────
  {
    name: 'General Document',
    site: CAMPUS_RENTALS,
    library: 'Documents',
    folder: 'Inbox/YYYY/MM',
    detect: () => true,
  },
];

/**
 * Find the first matching filing rule for a given attachment.
 * Returns the rule object with `folder` tokens resolved to actual dates.
 *
 * @param {string} filename  — attachment file name
 * @param {string} subject   — email subject
 * @returns {object}         — matched rule with resolved `folder`
 */
function matchRule(filename, subject) {
  const fn = (filename || '').toLowerCase().replace(/[^a-z0-9.]/g, ' ');
  const sub = (subject || '').toLowerCase();
  const now = new Date();
  const YYYY = String(now.getFullYear());
  const MM   = String(now.getMonth() + 1).padStart(2, '0');

  for (const rule of rules) {
    if (rule.detect(fn, sub)) {
      return {
        ...rule,
        folder: rule.folder.replace('YYYY', YYYY).replace('MM', MM),
      };
    }
  }
  // Should never reach here because catch-all always matches
  return null;
}

/**
 * Return all rules (for display / debugging).
 */
function listRules() {
  return rules.map(r => ({ name: r.name, site: r.site, library: r.library, folder: r.folder }));
}

module.exports = { matchRule, listRules, CAMPUS_RENTALS, ABODINGO };
