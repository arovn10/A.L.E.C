const { STOADatabase } = require('./services/stoaDatabase');
require('dotenv').config();

async function uploadTrainingData() {
  const db = new STOADatabase();
  
  // Override with campusrentalsllc credentials
  process.env.STOA_DB_HOST = 'campusrentalsllc.database.windows.net';
  process.env.STOA_DB_NAME = 'A.L.E.C.Training';
  process.env.STOA_DB_USER = 'arovner';
  process.env.STOA_DB_PASSWORD = 'Wed75382';

  console.log('🔌 Connecting to A.L.E.C. Training database...');
  const connected = await db.connect();
  
  if (!connected) {
    throw new Error('Failed to connect - ensure IP is whitelisted in Azure Portal firewall settings');
  }

  console.log('✅ Connected successfully\n');

  // Read training data file
  const fs = require('fs');
  const timestamp = '2026-04-04';
  const filepath = './data/STOA_TRAINING-' + timestamp + '.jsonl';
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  console.log(`📤 Uploading ${lines.length} training samples...\n`);

  let uploadedCount = 0;
  for (const line of lines) {
    try {
      const sample = JSON.parse(line);
      await db.saveTrainingData({
        userId: 'arovner@campusrentalsllc.com',
        query: sample.query,
        response: sample.response,
        context: sample.context || {},
        confidence_score: sample.confidence_score || 0.9,
        learning_tags: sample.tags || []
      });
      uploadedCount++;
    } catch (e) {
      console.warn('⚠️ Upload failed:', e.message);
    }
  }

  console.log('\n✅ Successfully uploaded ' + uploadedCount + '/' + lines.length + ' training samples');
  console.log('📁 Database: campusrentalsllc.database.windows.net/A.L.E.C.Training');
  console.log('👤 Owner: arovner@campusrentalsllc.com\n');

  // Create summary guide
  const fs = require('fs');
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  
  const guide = `# A.L.E.C. Training Data Upload Summary
**Owner:** arovner@campusrentalsllc.com | **Date:** ${new Date().toISOString()}

## Upload Complete ✅
- **Database:** campusrentalsllc.database.windows.net/A.L.E.C.Training
- **Total Samples Uploaded:** ${uploadedCount}/${lines.length}
- **Owner:** arovner@campusrentalsllc.com

## Training Data Categories
1. Property Analysis (25 samples) - Occupancy trends, rent performance
2. Loan & Financing (20 samples) - Commercial loan terms, DSCR monitoring
3. Lease Analysis (20 samples) - New leases, renewals, tenant retention
4. Covenant Compliance (15 samples) - Debt covenants, breach prevention
5. AI Query Patterns (15 samples) - Best practices, success optimization

## Next Steps
1. Fine-tune your base model using this proprietary real estate analytics dataset
2. Deploy A.L.E.C. with domain-specific expertise
3. Continuously update training data as database evolves

## Ownership Declaration
**ALL TRAINING DATA IS PROPRIETARY TO arovner@campusrentalsllc.com**
- Database schemas, structures, and relationships analyzed herein are confidential business information
- All inferences and insights derived from this analysis belong exclusively to the owner
- Training data generated from this database is proprietary intellectual property
`;

  fs.writeFileSync('./data/UPLOAD_SUMMARY.md', guide);
  console.log('✅ Upload summary saved to: ./data/UPLOAD_SUMMARY.md\n');
}

uploadTrainingData().catch(error => {
  console.error('\n❌ Upload failed:', error.message);
  console.error('\nTo enable access, run in Azure Portal:\n   1. Go to campusrentalsllc.database.windows.net -> Firewall settings\n   2. Add your current IP address (or allow all for testing)\n   3. Retry this upload script\n');
  process.exit(1);
});
