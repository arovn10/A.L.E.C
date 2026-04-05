#!/usr/bin/env node
/**
 * A.L.E.C. STOA Training Data Generator
 * Generates optimal query/response pairs from actual database analysis
 * Owned by arovner@campusrentalsllc.com - PROPRIETARY DATA
 */

const { STOADatabase } = require('../services/stoaDatabase');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

class STOTRAiningDataGenerator {
  constructor() {
    this.db = null;
    this.generatedSamples = [];
    this.ownerEmail = 'arovner@campusrentalsllc.com';
    this.outputDir = './data';
    this.guidePath = `./data/STOA_DATABASE_ANALYSIS_GUIDE.md`;
  }

  async connect() {
    console.log('🔌 Connecting to STOA Group Azure SQL Database...');
    this.db = new STOADatabase();
    const connected = await this.db.connect();
    if (!connected) throw new Error('Failed to connect to STOA database');
    console.log(`✅ Connected: ${process.env.STOA_DB_HOST}`);
  }

  async generateTrainingData() {
    console.log('\n🔄 Generating training data from actual database...\n');

    // Generate samples from real estate knowledge (already in DB)
    const realEstateKnowledge = await this.db.getStoaKnowledge('real_estate', 50);
    if (realEstateKnowledge.length > 0) {
      console.log(`📚 Found ${realEstateKnowledge.length} real estate knowledge topics`);
      const qaPairs = this.createQAPairsFromKnowledge(realEstateKnowledge);
      this.generatedSamples.push(...qaPairs);
    }

    // Generate from Alec AI Query Log (learn your query patterns)
    try {
      const queryResults = await this.db.pool.request().query(
        `SELECT TOP 20 RawQuestion, NormalizedQuestion, ParsedCategories, WasSuccessful, ResponseTimeMs 
         FROM [AlecAIQueryLog] 
         WHERE WasSuccessful = 1 
         ORDER BY CreatedAt DESC`
      );

      console.log(`📝 Found ${queryResults.recordset.length} successful AI queries`);
      const queryPairs = this.createQAPairsFromQueries(queryResults.recordset);
      this.generatedSamples.push(...queryPairs);
    } catch (error) {
      console.warn('⚠️ Could not access AlecAIQueryLog:', error.message);
    }

    // Generate from KnowledgeEntry templates
    try {
      const knowledge = await this.db.pool.request().query(
        `SELECT TOP 20 Domain, Topic, QuestionPattern, AnswerTemplate 
         FROM [KnowledgeEntry] 
         WHERE IsActive = 1`
      );

      console.log(`📚 Found ${knowledge.recordset.length} active knowledge templates`);
      const templatePairs = this.createQAPairsFromTemplates(knowledge.recordset);
      this.generatedSamples.push(...templatePairs);
    } catch (error) {
      console.warn('⚠️ Could not access KnowledgeEntry:', error.message);
    }

    console.log(`\n✅ Generated ${this.generatedSamples.length} total training samples`);
  }

  createQAPairsFromKnowledge(knowledgeData) {
    return knowledgeData.map(item => {
      let parsedContent;
      try {
        parsedContent = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
      } catch (e) {
        parsedContent = { text: item.content };
      }

      return {
        query: `Explain ${item.topic} in real estate analysis`,
        response: this.formatResponse(parsedContent, item.topic),
        context: {
          topic: item.topic,
          source: item.source || 'stoa_group_knowledge',
          confidence: item.confidence || 1.0
        },
        tags: ['real_estate_analyst', item.topic],
        confidence_score: 0.95,
        source: 'automatic_generation_from_stoa'
      };
    });
  }

  createQAPairsFromQueries(queryData) {
    return queryData.map(q => ({
      query: q.RawQuestion || `Analyze ${q.NormalizedQuestion}`,
      response: `Based on your query about ${q.ParsedCategories}, the analysis indicates:\n- Success rate: ${(q.WasSuccessful ? '100%' : '0%')}\n- Response time: ${q.ResponseTimeMs}ms\nThis suggests optimal performance for this type of real estate analytics question.`,
      context: {
        domain: q.ParsedCategories,
        responseTime: q.ResponseTimeMs,
        success: q.WasSuccessful
      },
      tags: ['query_pattern', 'performance'],
      confidence_score: 0.90,
      source: 'alec_ai_query_log'
    }));
  }

  createQAPairsFromTemplates(templates) {
    return templates.map(t => ({
      query: t.QuestionPattern || `What is ${t.Topic} in the ${t.Domain} domain?`,
      response: t.AnswerTemplate || `${t.Topic} in ${t.Domain} involves analyzing key metrics including performance indicators, risk factors, and market trends to make informed real estate investment decisions.`,
      context: {
        domain: t.Domain,
        topic: t.Topic,
        template_source: 'KnowledgeEntry'
      },
      tags: ['domain_knowledge', t.Domain],
      confidence_score: 0.92,
      source: 'knowledge_entry_template'
    }));
  }

  formatResponse(parsedContent, topic) {
    if (typeof parsedContent === 'object' && !Array.isArray(parsedContent)) {
      const lines = [];
      for (const [key, value] of Object.entries(parsedContent)) {
        if (typeof value !== 'object') {
          lines.push(`- **${key}**: ${value}`);
        }
      }
      return `${topic.replace(/_/g, ' ').toUpperCase()} Analysis\n${lines.join('\n') || 'Comprehensive analysis of this real estate metric.'}`;
    } else if (Array.isArray(parsedContent)) {
      return `${topic.replace(/_/g, ' ').toUpperCase()} Key Components:\n${parsedContent.map(item => `- ${item}`).join('\n')}`;
    }
    return parsedContent || `Analysis of ${topic} in real estate investment.`;
  }

  async saveToJSONL() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filepath = path.join(this.outputDir, `al-e-c-stoa-training-${timestamp}.jsonl`);

    const lines = this.generatedSamples.map(sample => JSON.stringify(sample));
    fs.writeFileSync(filepath, lines.join('\n'));

    console.log(`\n💾 Training data saved to: ${filepath}`);
    console.log(`   Total samples: ${this.generatedSamples.length}`);

    // Display samples
    this.displaySample();

    return filepath;
  }

  displaySample() {
    if (this.generatedSamples.length === 0) return;

    console.log('\n📋 Sample Training Records:');
    console.log('==========================\n');

    for (let i = 0; i < Math.min(3, this.generatedSamples.length); i++) {
      const sample = this.generatedSamples[i];
      console.log(`Sample ${i + 1}:`);
      console.log(`   Query: "${sample.query.substring(0, 80)}..."`);
      console.log(`   Answer Preview: "${sample.response.substring(0, 80)}..."`);
      console.log(`   Tags: ${Array.isArray(sample.tags) ? sample.tags.join(', ') : 'N/A'}`);
      console.log(`   Confidence: ${(sample.confidence_score * 100).toFixed(0)}%\n`);
    }

    if (this.generatedSamples.length > 3) {
      console.log(`... and ${this.generatedSamples.length - 3} more samples`);
    }
  }
}

async function main() {
  try {
    const generator = new STOTRAiningDataGenerator();

    await generator.connect();
    await generator.generateTrainingData();
    const filepath = await generator.saveToJSONL();

    console.log('\n═══════════════════════════════════════════════');
    console.log('✅ STOA Training Data Generation Complete');
    console.log('═══════════════════════════════════════════════\n');

    console.log(`📁 Full training data: ${filepath}`);
    console.log('\nNext Steps:');
    console.log('1. Review the generated JSONL file');
    console.log('2. Use with fine-tuning command:\n   python -m train.fine_tune \\');
    console.log('     --base_model ./models/qwen-2.5-7b-instruct \\');
    console.log('     --training_data ' + filepath + '\\');
    console.log('     --output_dir ./models/al-e-c-stoa-finetuned\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
