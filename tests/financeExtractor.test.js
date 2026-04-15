// tests/financeExtractor.test.js
'use strict';

const { extract } = require('../services/financeExtractor');

test('extracts dollar amounts', () => {
  const { amounts } = extract('The loan is $1,200,000 and a bridge of $500K was arranged.');
  expect(amounts).toContain('$1,200,000');
  expect(amounts).toContain('$500K');
});

test('extracts percentages', () => {
  const { percentages } = extract('Interest rate is 5.75% with a DSCR floor of 1.25%.');
  expect(percentages).toContain('5.75%');
  expect(percentages).toContain('1.25%');
});

test('extracts dates in MM/DD/YYYY format', () => {
  const { dates } = extract('Maturity date is 12/31/2026 and origination was 01/15/2021.');
  expect(dates).toContain('12/31/2026');
  expect(dates).toContain('01/15/2021');
});

test('extracts dates in Month DD, YYYY format', () => {
  const { dates } = extract('The closing occurred on March 15, 2023 and matures January 1, 2028.');
  expect(dates).toContain('March 15, 2023');
  expect(dates).toContain('January 1, 2028');
});

test('extracts known lender names case-insensitively', () => {
  const { lenders } = extract('Loan originated by jpmorgan with a WELLS FARGO participation.');
  expect(lenders.map((l) => l.toLowerCase())).toContain('jpmorgan');
  expect(lenders.map((l) => l.toLowerCase())).toContain('wells fargo');
});
