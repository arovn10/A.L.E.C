// services/financeExtractor.js
'use strict';

const KNOWN_LENDERS = [
  'JPMorgan',
  'Wells Fargo',
  'Bank of America',
  'Goldman Sachs',
  'Citibank',
  'KeyBank',
  'Regions Bank',
  'TD Bank',
  'Truist',
  'US Bank',
];

/**
 * Extract financial entities from raw text.
 * Pure function — no I/O.
 * @param {string} text
 * @returns {{ amounts: string[], percentages: string[], dates: string[], lenders: string[] }}
 */
function extract(text) {
  const amounts = (text.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|K)?/gi) || []).map(
    (s) => s.trim()
  );

  const percentages = text.match(/\d+(?:\.\d+)?%/g) || [];

  const dates =
    text.match(
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}\b/gi
    ) || [];

  const lenders = KNOWN_LENDERS.filter((lender) =>
    new RegExp(lender.replace(/\s+/g, '\\s+'), 'i').test(text)
  );

  return { amounts, percentages, dates, lenders };
}

module.exports = { extract };
