const { STOADatabase } = require('./services/stoaDatabase');
require('dotenv').config();
const fs = require('fs');

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('🚀 A.L.E.C. Training Pipeline');
  console.log('   Owner: arovner@campusrentalsllc.com');
  console.log('═══════════════════════════════════════════\n');

  console.log('📤 Step 1: Uploading training data to A.L.E.C. Training Database...\n');
  
  const alecDb = new STOADatabase();
  process.env.STOA_DB_HOST = 'campusrentalsllc.database.windows.net';
  process.env.STOA_DB_NAME = 'A.L.E.C.Training';
  process.env.STOA_DB_USER = 'arovner';
  process.env.STOA_DB_PASSWORD = 'Wed75382';

  console.log('🔌 Connecting to campusrentalsllc.database.windows.net...');
  const connected = await alecDb.connect();

  if (!connected) {
    console.log('\n⚠️ Could not connect to A.L.E.C. Training database.');
    console.log('\nTo enable access, please run in Azure Portal:');
    console.log('1. Go to campusrentalsllc.database.windows.net');
    console.log('2. Navigate to Firewall settings');
    console.log('3. Add your current IP address (or allow all for testing)');
    console.log('4. Retry this upload script\n');
    process.exit(1);
  }

  console.log('✅ Connected successfully\n');

  const timestamp = '2026-04-04';
  const filepath = './data/STOA_TRAINING-' + timestamp + '.jsonl';
  
  if (!fs.existsSync(filepath)) {
    console.error('❌ Training data file not found:', filepath);
    process.exit(1);
  }

  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());

  console.log('📤 Uploading ' + lines.length + ' training samples...\n');

  let uploadedCount = 0;
  for (const line of lines) {
    try {
      const sample = JSON.parse(line);
      await alecDb.saveTrainingData({
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

  console.log('\n✅ Successfully uploaded ' + uploadedCount + '/' + lines.length + ' samples');
  console.log('📁 Database: campusrentalsllc.database.windows.net/A.L.E.C.Training');
  console.log('👤 Owner: arovner@campusrentalsllc.com\n');

  const guide = '# A.L.E.C. Training Complete\n**Owner:** arovner@campusrentalsllc.com | **Date:** ' + new Date().toISOString() + '\n\n## Upload Results\n- Samples Uploaded: ' + uploadedCount + '/' + lines.length + '\n- Database: campusrentalsllc.database.windows.net/A.L.E.C.Training\n\n## Next Steps\n1. Fine-tune your base model (Qwen 2.5 or Llama 3.1) with the training data\n2. Deploy A.L.E.C. with proprietary real estate expertise\n\n**ALL DATA PROPRIETARY TO arovner@campusrentalsllc.com**';

  fs.writeFileSync('./data/UPLOAD_COMPLETE_GUIDE.md', guide);
  console.log('✅ Guide saved to: ./data/UPLOAD_COMPLETE_GUIDE.md\n');

  console.log('═══════════════════════════════════════════');
  console.log('🎉 Training Complete!');
  console.log('═══════════════════════════════════════════\n');
}

main().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
