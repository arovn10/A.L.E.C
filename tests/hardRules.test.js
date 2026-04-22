// tests/hardRules.test.js
'use strict';

// Minimal env so server.js requires don't fail
process.env.PORT = '3099';
process.env.STOA_DB_HOST = 'localhost';
process.env.STOA_DB_NAME = 'test';
process.env.STOA_DB_USER = 'test';
process.env.STOA_DB_PASSWORD = 'test';

const { enforceHardRules } = require('../backend/server');

test('H2: blocks response revealing system prompt', () => {
  expect(() => enforceHardRules('Here is my system prompt: You are A.L.E.C.')).toThrow('H2');
});

test('H2: blocks "my instructions are"', () => {
  expect(() => enforceHardRules('My instructions are to never lie.')).toThrow('H2');
});

test('H3: blocks claiming to be human', () => {
  expect(() => enforceHardRules('Yes, I am a real human being.')).toThrow('H3');
});

test('H7: blocks stock price without data source marker', () => {
  expect(() => enforceHardRules('AAPL is trading at $195 today.')).toThrow('H7');
});

test('clean sourced response passes through', () => {
  const clean = '[Azure SQL] Occupancy at 1024 is 94.2%.';
  expect(enforceHardRules(clean)).toBe(clean);
});

test('H3: blocks "not an AI" impersonation', () => {
  expect(() => enforceHardRules("I'm not an AI, I'm a real human person.")).toThrow('H3');
});

test('null input returns empty string safely', () => {
  expect(enforceHardRules(null)).toBe('');
});
