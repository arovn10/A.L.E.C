const { STOADatabase } = require('./services/stoaDatabase');
require('dotenv').config();

async function main() {
  const db = new STOADatabase();
  
  // Override with actual credentials for stoagroupDB
  process.env.STOA_DB_HOST = 'stoagroupdb.database.windows.net';
  process.env.STOA_DB_NAME = 'stoagroupDB';
  process.env.STOA_DB_USER = 'arovner@campusrentalsllc.com';
  process.env.STOA_DB_PASSWORD = 'Wed75382';

  console.log('🔌 Connecting to STOA Group Azure SQL Database...');
  const connected = await db.connect();
  if (!connected) throw new Error('Failed to connect');

  console.log('✅ Connected successfully\\n');

  // Get all tables
  const result = await db.pool.request().query(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = \'BASE TABLE\' ORDER BY TABLE_NAME'
  );

  const tables = result.recordset.map(t => t.TABLE_NAME);
  console.log(`📊 Found ${tables.length} tables in STOA database\\n`);

  // Analyze key tables for training insights
  let analysisGuide = `# A.L.E.C. STOA Database Complete Analysis\n**Owner:** arovner@campusrentalsllc.com | **Date:** ${new Date().toISOString()}\\n\\n## Summary\\nAnalyzed ${tables.length} tables total.\\n\\n---\\n`;

  const highPriorityTables = [];

  for (const tableName of tables) {
    try {
      // Get columns
      const colsResult = await db.pool.request().query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`
      );
      
      const columns = colsResult.recordset.map(c => c.COLUMN_NAME);
      
      // Get row count
      const countResult = await db.pool.request().query(
        `SELECT COUNT(*) as cnt FROM [${tableName}]`
      );
      
      const rowCount = parseInt(countResult.recordset[0].cnt);

      let priority = 'MEDIUM';
      let value = 0.8;
      let insights = [];

      if (tableName.includes('Property') || tableName.includes('Daily')) {
        priority = 'HIGH';
        value = 0.95;
        insights = ['Occupancy rates', 'Rent growth trends', 'Leasing velocity'];
      } else if (tableName.includes('Loan') || tableName.includes('Financial')) {
        priority = 'HIGH';
        value = 0.94;
        insights = ['Loan terms', 'Interest rates', 'DSCR requirements'];
      } else if (tableName.includes('Lease') || tableName.includes('Tenant')) {
        priority = 'HIGH';
        value = 0.92;
        insights = ['Lease terms', 'Renewal patterns', 'Creditworthiness'];
      } else if (tableName.includes('Covenant')) {
        priority = 'HIGH';
        value = 0.91;
        insights = ['Debt covenants', 'Compliance tracking', 'Risk assessment'];
      } else if (tableName.includes('Query') || tableName.includes('AI')) {
        priority = 'MEDIUM';
        value = 0.93;
        insights = ['User query patterns', 'Success rates', 'Response times'];
      }

      if (priority === 'HIGH') {
        highPriorityTables.push({ name: tableName, columns, rowCount, insights });
      }

      analysisGuide += `### ${tableName}\\n`;
      analysisGuide += `**Columns:** ${columns.join(', ')} | **Rows:** ${rowCount.toLocaleString()}\\n`;
      if (insights.length > 0) {
        analysisGuide += `**Key for Training:** ${insights.join(', ')}\\n`; 
      }
      analysisGuide += '\\n---\\n\\n';

    } catch (error) {
      console.warn(`⚠️ Error analyzing ${tableName}:`, error.message);
    }
  }

  // Save guide
  const fs = require('fs');
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  
  analysisGuide += `## High-Priority Tables for Training\\n`;
  highPriorityTables.forEach(t => {
    analysisGuide += `- **${t.name}** (${(0.95 * 100).toFixed(0)}%): ${t.insights.join(', ')}\\n`;
  });

  fs.writeFileSync('./data/STOA_ANALYSIS_GUIDE.md', analysisGuide);
  console.log('✅ Analysis guide saved to ./data/STOA_ANALYSIS_GUIDE.md\\n');

  // Generate training samples from real data
  console.log('🔄 Generating training samples...\\n');
  
  let samples = [];
  
  // Sample from DailyPropertyMetrics
  try {
    const metrics = await db.pool.request().query(
      `SELECT TOP 20 ReportDate, Property, OccupancyPct, BudgetedRent, AvgLeasedRent, RentGrowth3MoPct FROM DailyPropertyMetrics ORDER BY ReportDate DESC`
    );
    
    for (const m of metrics.recordset) {
      samples.push({
        query: `What is the occupancy and rent growth for ${m.Property}?`,
        response: `${m.Property}: Occupancy ${(m.OccupancyPct * 100).toFixed(1)}%, Budgeted Rent $${m.BudgetedRent.toFixed(2)}, Avg Leased $${m.AvgLeasedRent.toFixed(2)}, 3-Mo Growth ${(m.RentGrowth3MoPct * 100).toFixed(1)}%`,
        context: { property: m.Property },
        tags: ['property', 'occupancy'],
        confidence_score: 0.95,
        source: 'stoa_real_data'
      });
    }
  } catch (e) { console.warn('No DailyPropertyMetrics data'); }

  // Sample from Loan
  try {
    const loans = await db.pool.request().query(
      `SELECT TOP 15 LoanId, ProjectId, LoanAmount, InterestRate, MaturityDate FROM Loan ORDER BY LoanClosingDate DESC`
    );
    
    for (const l of loans.recordset) {
      samples.push({
        query: `Analyze loan #${l.LoanId} terms and risks.`,
        response: `Loan ${l.LoanId}: Amount $${(l.LoanAmount/1000).toFixed(0)}K, Rate ${l.InterestRate || 'Variable'}, Maturity ${l.MaturityDate}`, 
        context: { loan_id: l.LoanId },
        tags: ['loan', 'financial'],
        confidence_score: 0.94,
        source: 'stoa_real_data'
      });
    }
  } catch (e) { console.warn('No Loan data'); }

  // Sample from QueryLog patterns
  try {
    const queries = await db.pool.request().query(
      `SELECT TOP 10 RawQuestion, ParsedCategories, WasSuccessful FROM QueryLog WHERE WasSuccessful = 1 ORDER BY CreatedAt DESC`
    );
    
    for (const q of queries.recordset) {
      samples.push({
        query: q.RawQuestion,
        response: `Analysis of ${q.ParsedCategories}: Optimal performance achieved. This query type has high success rate.`,
        context: { domain: q.ParsedCategories },
        tags: ['query_pattern'],
        confidence_score: 0.90,
        source: 'stoa_real_data'
      });
    }
  } catch (e) { console.warn('No QueryLog data'); }

  // Save training data to JSONL
  const timestamp = new Date().toISOString().split('T')[0];
  const lines = samples.map(s => JSON.stringify(s));
  fs.writeFileSync(`./data/STOA_TRAINING_DATA-${timestamp}.jsonl`, lines.join('\n'));
  
  console.log(`✅ Generated ${samples.length} training samples`);
  console.log('📁 Saved to: ./data/STOA_TRAINING_DATA-' + timestamp + '.jsonl\\n');

  // Create upload script for campusrentalsllc.com
  const uploadScript = `const { STOADatabase } = require('./services/stoaDatabase');\nrequire('dotenv').config();\n\nasync function uploadTrainingData() {\n  const db = new STOADatabase();\n  \n  // Override with campusrentalsllc credentials\n  process.env.STOA_DB_HOST = 'campusrentalsllc.database.windows.net';\n  process.env.STOA_DB_NAME = 'A.L.E.C.Training';\n  process.env.STOA_DB_USER = 'arovner';\n  process.env.STOA_DB_PASSWORD = 'Wed75382';\n  \n  console.log('🔌 Connecting to A.L.E.C. Training database at campusrentalsllc...');\n  const connected = await db.connect();\n  if (!connected) throw new Error('Failed to connect to A.L.E.C. Training DB');\n  \n  console.log('✅ Connected successfully\\n');\n  \n  // Read training data file\n  const fs = require('fs');\n  const timestamp = '${timestamp}';\n  const filepath = './data/STOA_TRAINING_DATA-' + timestamp + '.jsonl';\n  const content = fs.readFileSync(filepath, 'utf8');\n  const lines = content.split('\\n').filter(l => l.trim());\n  \n  console.log('📤 Uploading ${samples.length} training samples to A.L.E.C. Training DB...\\n');\n  \n  let uploaded = 0;\n  for (const line of lines) {\n    try {\n      const sample = JSON.parse(line);\n      await db.saveTrainingData({\n        userId: 'arovner@campusrentalsllc.com',\n        query: sample.query,\n        response: sample.response,\n        context: sample.context || {},\n        confidence_score: sample.confidence_score || 0.9,\n        learning_tags: sample.tags || []\n      });\n      uploaded++;\n    } catch (e) {\n      console.warn('⚠️ Upload failed for sample:', e.message);\n    }\n  }\n  \n  console.log('\\n✅ Successfully uploaded ${uploaded}/${samples.length} training samples to A.L.E.C. Training database');\n  console.log('📁 Database: campusrentalsllc.database.windows.net/A.L.E.C.Training');\n  console.log('👤 Owner: arovner@campusrentalsllc.com\\n');\n}\n\nuploadTrainingData().catch(error => {\n  console.error('❌ Upload failed:', error.message);\n  process.exit(1);\n});`;

  fs.writeFileSync('./scripts/upload-to-alec-training.js', uploadScript);
  console.log('✅ Created upload script: ./scripts/upload-to-alec-training.js\\n');

  // Display summary
  console.log('═══════════════════════════════════════════');
  console.log('📊 STOA Database Analysis Complete');
  console.log('═══════════════════════════════════════════\\n');
  console.log(`Total Tables Analyzed: ${tables.length}`);
  console.log(`High-Priority Tables: ${highPriorityTables.length}`);
  console.log(`Training Samples Generated: ${samples.length}`);
  console.log('✅ Ready for upload to A.L.E.C. Training database\\n');
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
