// services/pdfIngestionService.js
'use strict';

const pdfParse = require('pdf-parse');
const axios = require('axios');
const weaviateService = require('./weaviateService');

const NEURAL_URL = process.env.NEURAL_URL || 'http://localhost:8000';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;

/**
 * Split text into overlapping chunks.
 * @param {string} text
 * @returns {string[]}
 */
function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Embed a piece of text via the neural server.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const response = await axios.post(`${NEURAL_URL}/embed`, { text });
  return response.data.vector;
}

/**
 * Ingest a PDF buffer into Weaviate.
 * @param {Buffer} buffer - Raw PDF bytes
 * @param {string} filename - Original file name (used as docUuid base)
 * @returns {Promise<{ docUuid: string, chunkCount: number, pageCount: number }>}
 */
async function ingest(buffer, filename) {
  const parsed = await pdfParse(buffer);
  const { text, numpages } = parsed;

  const chunks = chunkText(text);
  const baseDocUuid = `pdf::${filename}`;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText_ = chunks[i];
    const docUuid = `${baseDocUuid}::${i}`;
    const vector = await embed(chunkText_);
    await weaviateService.upsert(
      'ALECDocument',
      {
        docUuid,
        chunkIndex: i,
        content: chunkText_,
        sourceType: 'pdf',
        sourceUrl: filename,
        tags: ['pdf', 'upload'],
        indexedAt: new Date().toISOString(),
      },
      vector
    );
  }

  return {
    docUuid: baseDocUuid,
    chunkCount: chunks.length,
    pageCount: numpages,
  };
}

/**
 * Retrieve and join chunk content for a given base docUuid.
 * @param {string} baseDocUuid - e.g. "pdf::myfile.pdf"
 * @returns {Promise<string>} First 2000 chars of joined content
 */
async function getSummary(baseDocUuid) {
  const results = await weaviateService.hybridSearch(
    'ALECDocument',
    '',
    [],
    20
  );
  const relevant = results.filter(
    (r) => r.docUuid && r.docUuid.startsWith(baseDocUuid)
  );
  const joined = (relevant.length > 0 ? relevant : results)
    .map((r) => r.content || '')
    .join('\n');
  return joined.slice(0, 2000);
}

module.exports = { ingest, getSummary };
