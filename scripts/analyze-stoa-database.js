#!/usr/bin/env node
/**
 * A.L.E.C. STOA Database Analyzer
 * Systematically analyzes every table and data point in the actual STOA Group database
 * Owned by arovner@campusrentalsllc.com - PROPRIETARY DATA ANALYSIS
 */

const { STOADatabase } = require('../services/stoaDatabase');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

class STODatabaseAnalyzer {
  constructor() {
    this.db = null;
    this.tables = [];
    this.analysisGuide = [];
    this.ownerEmail = 'arovner@campusrentalsllc.com';
    this.guidePath = './data/STOA_DATABASE_ANALYSIS_GUIDE.md';
  }

  /** Connect to actual STOA Group Azure SQL database */
  async connect() {
    console.log('🔌 Connecting to actual STOA Group Azure SQL Database...');
    
    this.db = new STOADatabase();
    const connected = await this.db.connect();
    
    if (!connected) {
      throw new Error('Failed to connect to STOA database - check credentials in .env');
    }

    console.log(`✅ Connected to: ${process.env.STOA_DB_HOST}`);
    console.log(`   Database: ${process.env.STOA_DB_NAME}`);
    console.log(`   User: ${process.env.STOA_DB_USER}\n`);
  }

  /** List all tables in the database */
  async listTables() {
    try {
      const result = await this.db.pool.request().query(
        `SELECT TABLE_NAME 
         FROM INFORMATION_SCHEMA.TABLES 
         WHERE TABLE_TYPE = 'BASE TABLE' 
         ORDER BY TABLE_NAME`
      );

      this.tables = result.recordset.map(t => t.TABLE_NAME);
      console.log(`📊 Found ${this.tables.length} tables in STOA database:\n`);
      
      for (let i = 0; i < this.tables.length; i++) {
        console.log(`${i + 1}. ${this.tables[i]}`);
      }
      console.log();

      return this.tables;
    } catch (error) {
      console.error('❌ Error listing tables:', error.message);
      throw error;
    }
  }

  /** Analyze a single table's structure and data */
  async analyzeTable(tableName) {
    try {
      // Get column information
      const columnsResult = await this.db.pool.request().query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
         FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_NAME = '${tableName}' 
         ORDER BY ORDINAL_POSITION`
      );

      const columns = columnsResult.recordset;
      console.log(`\n📋 Table: ${tableName}`);
      console.log('   Columns:', columns.map(c => `${c.COLUMN_NAME} (${c.DATA_TYPE})`).join(', '));

      // Get row count
      const countResult = await this.db.pool.request().query(
        `SELECT COUNT(*) as rowCount FROM [${tableName}]`
      );
      
      const rowCount = parseInt(countResult.recordset[0].rowCount);
      console.log(`   Total Rows: ${rowCount}`);

      // Sample data (first 3 rows)
      if (rowCount > 0) {
        const sampleQuery = `SELECT TOP 3 * FROM [${tableName}]`;
        const sampleResult = await this.db.pool.request().query(sampleQuery);
        
        console.log('   Sample Data:');
        for (const row of sampleResult.recordset) {
          console.log(`   └─ ${this.stringifyRow(row, 100)}`);
        }
      }

      return { columns, rowCount };
    } catch (error) {
      console.warn(`⚠️ Error analyzing table ${tableName}:`, error.message);
      return null;
    }
  }

  stringifyRow(row, maxLength = 100) {
    const str = JSON.stringify(row);
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  }

  /** Generate inferences and insights for A.L.E.C */
  generateInferences(tableName, columns, rowCount) {
    const inferences = [];

    // Common patterns to detect
    if (tableName.includes('property') || tableName.includes('asset')) {
      inferences.push({
        type: 'domain_knowledge',
        topic: 'Property Valuation & Management',
        insight: `Database contains ${rowCount} property/asset records. A.L.E.C should learn:
- Property valuation methodologies (comparable sales, income approach)
- Cap rate calculations and market benchmarks
- Tenant mix analysis and lease expiration tracking
- NOI calculation from rental income minus operating expenses`,
        priority: 'HIGH',
        trainingValue: 0.95
      });
    }

    if (tableName.includes('lease') || tableName.includes('tenant')) {
      inferences.push({
        type: 'domain_knowledge',
        topic: 'Lease Analysis & Tenant Management',
        insight: `Database contains ${rowCount} lease/tenant records. A.L.E.C should learn:
- Lease term analysis and renewal strategies
- Tenant creditworthiness assessment
- CAM charges, base rent calculations
- Expiration risk identification`,
        priority: 'HIGH',
        trainingValue: 0.92
      });
    }

    if (tableName.includes('financial') || tableName.includes('income')) {
      inferences.push({
        type: 'domain_knowledge',
        topic: 'Financial Analysis & Modeling',
        insight: `Database contains ${rowCount} financial records. A.L.E.C should learn:
- NOI, DSCR, IRR calculations
- Cash flow projection methodologies
- Sensitivity analysis for market scenarios
- Investment return metrics (NPV, Equity Multiple)`,
        priority: 'HIGH',
        trainingValue: 0.94
      });
    }

    if (tableName.includes('market') || tableName.includes('comparable')) {
      inferences.push({
        type: 'domain_knowledge',
        topic: 'Market Analysis & Comparables',
        insight: `Database contains ${rowCount} market/comparable records. A.L.E.C should learn:
- Comparable selection criteria and adjustment factors
- Market trend analysis techniques
- Supply/demand dynamics in local markets
- Pricing strategies based on comparables`,
        priority: 'MEDIUM',
        trainingValue: 0.88
      });
    }

    if (tableName.includes('report') || tableName.includes('analysis')) {
      inferences.push({
        type: 'communication_pattern',
        topic: 'Report Generation & Communication Style',
        insight: `Database contains ${rowCount} reports/analyses. A.L.E.C should learn:
- Preferred report structure and formatting
- Key metrics to highlight for stakeholders
- Professional communication tone
- Executive summary best practices`,
        priority: 'MEDIUM',
        trainingValue: 0.85
      });
    }

    return inferences;
  }

  /** Write analysis to guide file */
  async writeGuide() {
    const content = `# STOA Group Database Analysis Guide
## A.L.E.C. Training Data Foundation
**Owner:** ${this.ownerEmail} | **Analysis Date:** ${new Date().toISOString()} | **Status:** PROPRIETARY DATA ANALYSIS

---

## Executive Summary
This guide documents systematic analysis of the STOA Group Azure SQL database for training A.L.E.C., a real estate analyst AI agent.

### Database Overview
- **Host:** ${process.env.STOA_DB_HOST}
- **Database:** ${process.env.STOA_DB_NAME}
- **Owner:** ${this.ownerEmail}
- **Total Tables Analyzed:** ${this.tables.length}
- **Analysis Status:** In Progress

---

## Table-by-Table Analysis

`; // Start fresh guide

    for (const table of this.tables) {
      const analysis = await this.analyzeTable(table);
      if (!analysis) continue;

      const inferences = this.generateInferences(table, analysis.columns, analysis.rowCount);

      content += `### ${table.toUpperCase()}
- **Columns:** ${analysis.columns.map(c => c.COLUMN_NAME).join(', ')}
- **Row Count:** ${analysis.rowCount}
- **Data Types:** ${analysis.columns.map(c => `${c.COLUMN_NAME} (${c.DATA_TYPE})`).join(', ')}

#### Inferences for A.L.E.C. Training:
${inferences.length > 0 ? inferences.map(i => `**[${i.priority}]** ${i.topic}
- Insight: ${i.insight.split('\n').slice(1).join('\n')}
- Training Value: ${(i.trainingValue * 100).toFixed(0)}%
`).join('\n\n') : 'No specific training inferences identified'}

---
`;
    }

    content += `## Next Steps for A.L.E.C. Training

### Phase 1: Domain Knowledge Extraction
Based on the analysis above, prioritize training data generation from:
1. **Property/Asset Tables** (Priority: HIGH - Value: 95%)
2. **Financial Records** (Priority: HIGH - Value: 94%)
3. **Lease/Tenant Data** (Priority: HIGH - Value: 92%)

### Phase 2: Communication Pattern Learning
Extract from report/analysis tables to learn:
- Report structure preferences
- Stakeholder communication style
- Executive summary best practices

### Phase 3: Model Fine-tuning
Use generated training data with base model (Qwen 2.5 or Llama 3.1) for fine-tuning.

---

## Ownership Declaration
**ALL ANALYSIS AND TRAINING DATA IS PROPRIETARY TO ${this.ownerEmail}**
- All database schemas, structures, and relationships analyzed herein are confidential business information
- All inferences and insights derived from this analysis belong to the owner
- Training data generated from this database is proprietary intellectual property
`;

    // Ensure directory exists
    const outputDir = path.dirname(this.guidePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(this.guidePath, content);
    console.log(`\n✅ Guide written to: ${this.guidePath}`);
  }
}

// Main execution
async function main() {
  try {
    const analyzer = new STODatabaseAnalyzer();

    console.log('═══════════════════════════════════════════════');
    console.log('🔍 A.L.E.C. STOA Database Systematic Analyzer');
    console.log('   Owner: arovner@campusrentalsllc.com');
    console.log('═══════════════════════════════════════════════\n');

    // Step 1: Connect to actual database
    await analyzer.connect();

    // Step 2: List all tables
    await analyzer.listTables();

    // Step 3: Generate analysis guide (will include all table details)
    await analyzer.writeGuide();

    console.log('\n═══════════════════════════════════════════════');
    console.log('✅ Database Analysis Complete');
    console.log('═══════════════════════════════════════════════\n');

    console.log(`📁 Full analysis guide saved to: ${analyzer.guidePath}`);
    console.log('\nNext Steps:');
    console.log('1. Review the guide at ' + analyzer.guidePath);
    console.log('2. Use insights to create training data for A.L.E.C.');
    console.log('3. Upload generated training data to your ALEC database');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
