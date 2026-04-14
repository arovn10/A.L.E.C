// config/weaviate.js
'use strict';

const WEAVIATE_HOST = process.env.WEAVIATE_HOST || 'localhost';
const WEAVIATE_PORT = process.env.WEAVIATE_PORT || '8080';

/**
 * Collection schema definitions. vectorizer: 'none' because we supply
 * our own vectors via nomic-embed-text on DGX Spark.
 */
const COLLECTIONS = {
  ALECConversation: {
    class: 'ALECConversation',
    vectorizer: 'none',
    description: 'Every chat turn ALEC has ever had — episodic RAG retrieval.',
    properties: [
      { name: 'turnId',       dataType: ['text'],   description: 'UUID for this turn' },
      { name: 'sessionId',    dataType: ['text'],   description: 'Groups turns into a session' },
      { name: 'userMsg',      dataType: ['text'],   description: 'User message text' },
      { name: 'alecResponse', dataType: ['text'],   description: 'ALEC reply text' },
      { name: 'qualityScore', dataType: ['number'], description: 'Automated quality score 0-1' },
      { name: 'promoted',     dataType: ['boolean'],description: 'Added to SFT batch?' },
      { name: 'timestamp',    dataType: ['date'],   description: 'ISO8601 turn timestamp' },
    ],
  },

  ALECEntity: {
    class: 'ALECEntity',
    vectorizer: 'none',
    description: 'Extracted facts — Properties, Tenants, Loans, Persons, Covenants.',
    properties: [
      { name: 'entityType',  dataType: ['text'],   description: 'Property|Tenant|Loan|Person|Covenant' },
      { name: 'name',        dataType: ['text'],   description: 'Entity display name' },
      { name: 'attributes',  dataType: ['text'],   description: 'JSON blob of key-value attributes' },
      { name: 'source',      dataType: ['text'],   description: 'Where this was extracted from' },
      { name: 'confidence',  dataType: ['number'], description: 'Extraction confidence 0-1' },
      { name: 'updatedAt',   dataType: ['date'],   description: 'Last updated ISO8601' },
    ],
  },

  ALECDocument: {
    class: 'ALECDocument',
    vectorizer: 'none',
    description: 'Indexed copies of STOA GitHub files and uploaded PDFs.',
    properties: [
      { name: 'docUuid',    dataType: ['text'],   description: 'UUID for the source document' },
      { name: 'chunkIndex', dataType: ['int'],    description: 'Chunk index within document (0-based)' },
      { name: 'content',    dataType: ['text'],   description: 'Chunk text content' },
      { name: 'sourceType', dataType: ['text'],   description: 'github|pdf|tenantcloud|azuresql' },
      { name: 'sourceUrl',  dataType: ['text'],   description: 'Original file path or URL' },
      { name: 'tags',       dataType: ['text[]'], description: 'Tags: loan, banking, lease, etc.' },
      { name: 'indexedAt',  dataType: ['date'],   description: 'When this chunk was indexed' },
    ],
  },
};

module.exports = {
  COLLECTIONS,
  WEAVIATE_HOST,
  WEAVIATE_PORT,
  WEAVIATE_URL: `http://${WEAVIATE_HOST}:${WEAVIATE_PORT}`,
};
