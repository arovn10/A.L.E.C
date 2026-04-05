#!/usr/bin/env node
/**
 * A.L.E.C. Neural Engine MCP Server
 * Real-time LLM inference with personality traits
 */

const { NeuralEngine } = require('../neuralEngine');

class NeuralEngineMCP {
  constructor() {
    this.neuralEngine = new NeuralEngine();
    this.initialized = false;
  }

  async initialize() {
    console.log('🧠 Initializing Neural Engine MCP Server...');
    const ready = await this.neuralEngine.initialize();
    if (ready) {
      this.initialized = true;
      console.log('✅ Neural Engine ready for queries');
    } else {
      console.warn('⚠️ Neural Engine failed to initialize, using fallback mode');
    }
    return this.initialized;
  }

  async processQuery(query, personality = 'companion', context = {}) {
    if (!this.initialized) await this.initialize();

    try {
      const result = await this.neuralEngine.processQuery({
        query,
        personality,
        initiativeMode: true,
        ...context
      });
      return { success: true, ...result };
    } catch (error) {
      console.error('Neural Engine error:', error);
      return {
        success: false,
        error: error.message,
        fallback: `I apologize, but I'm experiencing technical difficulties. ${query}`
      };
    }
  }

  async getStats() {
    const stats = this.neuralEngine.getStats();
    return { success: true, ...stats };
  }

  async getModelStatus() {
    const status = this.neuralEngine.getModelStatus();
    return { success: true, ...status };
  }

  async setPersonalityTraits(traits) {
    // traits should be an object like { sass: 0.8, empathy: 0.9, ... }
    if (!this.initialized) await this.initialize();

    const currentTraits = this.neuralEngine.personalityTraits;
    Object.assign(currentTraits, traits);

    await this.neuralEngine.savePersonalityTraits();
    return { success: true, message: 'Personality traits updated' };
  }

  async handleRequest(request) {
    switch (request.method) {
      case 'query':
        return this.processQuery(
          request.params.query,
          request.params.personality,
          request.params.context || {}
        );
      case 'stats':
        return this.getStats();
      case 'model/status':
        return this.getModelStatus();
      case 'personality/update':
        return this.setPersonalityTraits(request.params.traits);
      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }

  async run() {
    await this.initialize();

    process.stdin.on('data', async (chunk) => {
      try {
        const request = JSON.parse(chunk.toString());
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        console.error('MCP Error:', error.message);
      }
    });

    console.log('🧠 Neural Engine MCP Server ready');
  }
}

const server = new NeuralEngineMCP();
server.run().catch(console.error);
