#!/usr/bin/env node
/**
 * A.L.E.C. Document Processor MCP Server
 * Analyzes PDF, DOCX, and TXT documents as a real estate analyst
 */

const { NeuralEngine } = require('../neuralEngine');
const { DocumentProcessor } = require('../documentProcessor');
const { STOADatabase } = require('../stoaDatabase');

class DocumentProcessorMCP {
  constructor() {
    this.neuralEngine = new NeuralEngine();
    this.documentProcessor = new DocumentProcessor();
    this.stoaDatabase = new STOADatabase();
    this.isConnected = false;
  }

  async initialize() {
    console.log('📄 Initializing Document Processor MCP Server...');
    await this.connectDatabase();
    return true;
  }

  async connectDatabase() {
    try {
      const connected = await this.stoaDatabase.connect();
      if (connected) {
        this.isConnected = true;
        console.log('✅ Connected to STOA Database');
      } else {
        console.warn('⚠️ Database connection failed, continuing without persistence');
      }
    } catch (error) {
      console.error('❌ Database connection error:', error.message);
    }
  }

  async analyzeDocument(filePath, userId = 'mcp_user') {
    try {
      if (!this.isConnected) await this.connectDatabase();

      const result = await this.documentProcessor.uploadDocument(
        { path: filePath },
        userId
      );

      if (!result.success) return { error: result.error };

      const processedResult = await this.documentProcessor.processDocument(
        result.filepath,
        result.filename
      );

      const analysis = await this.documentProcessor.analyzeAsRealEstateAnalyst(
        JSON.parse(processedResult.content),
        userId
      );

      return { success: true, ...analysis };
    } catch (error) {
      console.error('Document analysis error:', error);
      return { error: error.message };
    }
  }

  async getKnowledge(topic = null, limit = 10) {
    if (!this.isConnected) await this.connectDatabase();
    const knowledge = await this.stoaDatabase.getStoaKnowledge(topic, limit);
    return { success: true, knowledge };
  }

  async updateKnowledge(topic, content, source = 'mcp', confidence = 1.0) {
    if (!this.isConnected) await this.connectDatabase();
    const success = await this.stoaDatabase.updateStoaKnowledge({
      topic,
      content,
      source,
      confidence
    });
    return { success: true, message: 'Knowledge base updated' };
  }

  async handleRequest(request) {
    switch (request.method) {
      case 'document/analyze':
        return this.analyzeDocument(
          request.params.filePath,
          request.params.userId
        );
      case 'knowledge/get':
        return this.getKnowledge(
          request.params.topic,
          request.params.limit
        );
      case 'knowledge/update':
        return this.updateKnowledge(
          request.params.topic,
          request.params.content,
          request.params.source,
          request.params.confidence
        );
      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }

  async run() {
    await this.initialize();

    // Simple stdin/stdout protocol for MCP
    process.stdin.on('data', async (chunk) => {
      try {
        const request = JSON.parse(chunk.toString());
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        console.error('MCP Error:', error.message);
      }
    });

    console.log('📄 Document Processor MCP Server ready');
  }
}

const server = new DocumentProcessorMCP();
server.run().catch(console.error);
