const test = require('node:test');
const assert = require('node:assert/strict');

const { getGroqModelCandidates } = require('../lib/index.js');

test('getGroqModelCandidates prefers the requested model and keeps a fallback list', () => {
  assert.deepStrictEqual(getGroqModelCandidates('llama-3.3-70b-versatile'), [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ]);

  assert.deepStrictEqual(getGroqModelCandidates('unknown-model'), [
    'unknown-model',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
  ]);
});
