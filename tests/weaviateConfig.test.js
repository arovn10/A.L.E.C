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

test('ALECEntity has required properties', () => {
  const props = COLLECTIONS.ALECEntity.properties.map(p => p.name);
  expect(props).toEqual(
    expect.arrayContaining(['entityType', 'name', 'attributes', 'confidence'])
  );
});

test('all collections use vectorizer none', () => {
  for (const col of Object.values(COLLECTIONS)) {
    expect(col.vectorizer).toBe('none');
  }
});
