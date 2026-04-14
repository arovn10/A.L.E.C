// tests/weaviateConfig.test.js
'use strict';
const { COLLECTIONS } = require('../config/weaviate');

test('exports three collection definitions', () => {
  expect(Object.keys(COLLECTIONS)).toEqual(
    expect.arrayContaining(['ALECConversation', 'ALECEntity', 'ALECDocument'])
  );
});

test('ALECConversation has required properties', () => {
  const props = COLLECTIONS.ALECConversation.properties.map(p => p.name);
  expect(props).toEqual(
    expect.arrayContaining(['turnId', 'userMsg', 'alecResponse', 'qualityScore', 'sessionId'])
  );
});

test('ALECDocument has sourceType and tags properties', () => {
  const props = COLLECTIONS.ALECDocument.properties.map(p => p.name);
  expect(props).toEqual(expect.arrayContaining(['sourceType', 'tags', 'content', 'docUuid']));
});
