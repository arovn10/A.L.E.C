const { STOADatabase } = require('./services/stoaDatabase');
require('dotenv').config();

async function main() {
  const db = new STOADatabase();
  
  // Use existing env vars for stoagroupDB (already configured)
  console.log('🔌 Connecting to STOA Group Azure SQL Database...');
  console.log(`   Host: ${process.env.STOA_DB_HOST}`);
  console.log(`   DB: ${process.env.STOA_DB_NAME}`);
  
  const connected = await db.connect();
  if (!connected) throw new Error('Failed to connect to STOA database');

  console.log('✅ Connected successfully\\n');

  // Get all tables
  const result = await db.pool.request().query(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = \'BASE TABLE\' ORDER BY TABLE_NAME'
  );

  const tables = result.recordset.map(t => t.TABLE_NAME);
  console.log(`📊 Found ${tables.length} tables\\n`);

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
    analysisGuide += `- **${t.name}** (${(value * 100).toFixed(0)}%): ${t.insights.join(', ')}\\n`;
  });

  fs.writeFileSync('./data/STOA_ANALYSIS_GUIDE.md', analysisGuide);
  console.log('✅ Analysis guide saved to ./data/STOA_ANALYSIS_GUIDE.md\\n');

  // Generate training samples from real data
  console.log('🔄 Generating training samples...\\n');
  
  let samples = [];
  
  try {
    const metrics = await db.pool.request().query(
      `SELECT TOP 20 ReportDate, Property, OccupancyPct, BudgetedRent, AvgLeasedRent FROM DailyPropertyMetrics ORDER BY ReportDate DESC`
    );
    for (const m of metrics.recordset) {
      samples.push({
        query: `What is the occupancy and rent growth for ${m.Property}?`,
        response: `${m.Property}: Occupancy ${(m.OccupancyPct * 100).toFixed(1)}%, Budgeted Rent $${m.BudgetedRent.toFixed(2)}, Avg Leased $${m.AvgLeasedRent.toFixed(2)}`,
        context: { property: m.Property },
        tags: ['property', 'occupancy'],
        confidence_score: 0.95,
        source: 'stoa_real_data'
      });
    }
  } catch (e) { console.warn('No DailyPropertyMetrics data'); }

  try {
    const loans = await db.pool.request().query(
      `SELECT TOP 15 LoanId, ProjectId, LoanAmount, InterestRate FROM Loan ORDER BY LoanClosingDate DESC`
    );
    for (const l of loans.recordset) {
      samples.push({
        query: `Analyze loan #${l.LoanId} terms and risks.`,
        response: `Loan ${l.LoanId}: Amount $${(l.LoanAmount/1000).toFixed(0)}K, Rate ${l.InterestRate || 'Variable'}`, 
        context: { loan_id: l.LoanId },
        tags: ['loan', 'financial'],
        confidence_score: 0.94,
        source: 'stoa_real_data'
      });
    }
  } catch (e) { console.warn('No Loan data'); }

  const timestamp = new Date().toISOString().split('T')[0];
  const lines = samples.map(s => JSON.stringify(s));
  fs.writeFileSync(`./data/STOA_TRAINING_DATA-${timestamp}.jsonl`, lines.join('\n'));
  
  console.log(`✅ Generated ${samples.length} training samples`);
  console.log('📁 Saved to: ./data/STOA_TRAINING_DATA-' + timestamp + '.jsonl\\n');

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
