// services/weaviateService.js
'use strict';

const weaviate = require('weaviate-ts-client').default;
const { COLLECTIONS, WEAVIATE_HOST, WEAVIATE_PORT } = require('../config/weaviate');

class WeaviateService {
  constructor() {
    this.client = weaviate({ scheme: 'http', host: `${WEAVIATE_HOST}:${WEAVIATE_PORT}` });
  }

  /** Connect and ensure all three collections exist. Call once at server startup. */
  async init() {
    for (const [name, schema] of Object.entries(COLLECTIONS)) {
      const exists = await this.client.schema.exists(name);
      if (!exists) {
        await this.client.schema.classCreator().withClass(schema).do();
        console.log(`[Weaviate] Created collection: ${name}`);
      }
    }
    console.log('[Weaviate] All collections ready');
  }

  /** @returns {Promise<boolean>} */
  async health() {
    try {
      await this.client.misc.liveChecker().do();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Upsert a document into a Weaviate collection.
   * @param {string} collection - 'ALECConversation'|'ALECEntity'|'ALECDocument'
   * @param {object} properties - Fields matching the collection schema
   * @param {number[]} vector - Embedding from nomic-embed-text
   * @returns {Promise<string>} Weaviate object ID
   */
  async upsert(collection, properties, vector) {
    const result = await this.client.data
      .creator()
      .withClassName(collection)
      .withProperties(properties)
      .withVector(vector)
      .do();
    return result.id;
  }

  /**
   * Vector similarity search.
   * @param {string} collection
   * @param {number[]} vector
   * @param {{ limit?: number, fields?: string }} opts
   * @returns {Promise<Array<{distance: number, id: string, [key: string]: any}>>}
   */
  async search(collection, vector, { limit = 5, fields = '' } = {}) {
    const schemaFields = (COLLECTIONS[collection]?.properties || []).map(p => p.name).join(' ');
    const allFields = [schemaFields, fields, '_additional { distance id }'].filter(Boolean).join(' ');

    const result = await this.client.graphql.get()
      .withClassName(collection)
      .withNearVector({ vector })
      .withLimit(limit)
      .withFields(allFields)
      .do();

    const items = result?.data?.Get?.[collection] || [];
    return items.map(item => ({
      ...item,
      distance: item._additional?.distance ?? null,
      id: item._additional?.id ?? null,
    }));
  }

  /**
   * Hybrid search — vector + BM25 keyword (alpha: 0.5 = equal weight).
   * @param {string} collection
   * @param {string} query - Natural language query string
   * @param {number[]} vector
   * @param {{ limit?: number }} opts
   * @returns {Promise<Array>}
   */
  async hybridSearch(collection, query, vector, { limit = 5 } = {}) {
    const schemaFields = (COLLECTIONS[collection]?.properties || []).map(p => p.name).join(' ');
    const allFields = `${schemaFields} _additional { distance score id }`;

    const result = await this.client.graphql.get()
      .withClassName(collection)
      .withHybrid({ query, vector, alpha: 0.5 })
      .withLimit(limit)
      .withFields(allFields)
      .do();

    const items = result?.data?.Get?.[collection] || [];
    return items.map(item => ({
      ...item,
      distance: item._additional?.distance ?? null,
      score: item._additional?.score ?? null,
      id: item._additional?.id ?? null,
    }));
  }
}

module.exports = WeaviateService;
