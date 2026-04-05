#!/usr/bin/env node
/**
 * A.L.E.C. STOA Group Knowledge Initialization Script
 * Loads comprehensive context about STOA Group into the AI's knowledge base
 */

require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const { STOADatabase } = require('../services/stoaDatabase');

async function initializeStoaKnowledge() {
  console.log('🔄 Initializing STOA Group Knowledge in A.L.E.C....\n');

  const db = new STOADatabase();

  try {
    // Connect to database
    const connected = await db.connect();

    if (!connected) {
      console.error('❌ Failed to connect to STOA Database. Aborting initialization.');
      process.exit(1);
    }

    console.log('✅ Connected to STOA Database successfully\n');

    // Define comprehensive STOA Group knowledge base
    const stoaKnowledge = [
      {
        topic: 'STOA_Group_Overview',
        content: `STOA Group is a technology company focused on innovative solutions. The organization values efficiency, innovation, and user-centric design. A.L.E.C. (Adaptive Learning Executive Coordinator) serves as the intelligent assistant for STOA Group operations.\n\nKey characteristics:\n- Technology-driven organization\n- Values data-driven decision making\n- Emphasizes continuous improvement\n- Maintains comprehensive documentation systems`,
        source: 'STOA_Group_Overview',
        confidence: 1.0,
        updated_by: 'system'
      },
      {
        topic: 'A.L.E.C._Purpose',
        content: `A.L.E.C. (Adaptive Learning Executive Coordinator) is an intelligent AI assistant developed for STOA Group with the following capabilities:\n\nCore Functions:\n- Personal AI assistance with witty & proactive personality\n- Adaptive learning from user interactions\n- Document processing and analysis\n- Smart home integration management\n- Knowledge base maintenance via Azure SQL Server\n- Multi-platform integrations (Teams, iMessage, Asana, Outlook, Gmail)\n- GitHub repository management for Stoa Group\n\nPersonality Traits:\n- Witty and engaging communication style\n- Proactive in offering assistance\n- Learns from interactions to improve over time\n- Maintains context across conversations`,
        source: 'A.L.E.C._System_Design',
        confidence: 1.0,
        updated_by: 'system'
      },
      {
        topic: 'Database_Architecture',
        content: `STOA Group uses Azure SQL Server as the permanent data source for A.L.E.C.\n\nDatabase Configuration:\n- Host: stoagroupdb.database.windows.net\n- Database Name: stoagroupDB\n- Primary Tables:\n  * altec_training_data - Stores learning interactions\n  * stoa_group_knowledge - Contains organizational knowledge base\n  * model_updates - Tracks AI model evolution\n\nData Flow:\n1. User interactions stored in training data with context\n2. Confidence scores track reliability of information\n3. Model updates logged for version tracking\n4. Knowledge base maintained with confidence scoring`,
        source: 'Database_Schema',
        confidence: 0.95,
        updated_by: 'system'
      },
      {
        topic: 'Integrations_Available',
        content: `A.L.E.C. integrates with multiple platforms for STOA Group operations:\n\nCommunication Platforms:\n- Microsoft Teams API - Team collaboration and messaging\n- Apple iMessage API - Mobile messaging integration\n- Microsoft Outlook API - Email management and calendar\n- Google Gmail API - Alternative email system\n\nProject Management:\n- Asana API - Task tracking and project coordination\n\nDeveloper Tools:\n- GitHub API - Full access to Stoa Group repositories\n  * Repository mastery capabilities\n  * Code analysis support\n  * Version control assistance`,
        source: 'Integration_Registry',
        confidence: 0.95,
        updated_by: 'system'
      },
      {
        topic: 'Smart_Home_Integration',
        content: `STOA Group maintains smart home infrastructure integrated with A.L.E.C.\n\nCapabilities:\n- Device control and monitoring\n- Automated routines and scheduling\n- Energy optimization suggestions\n- Security system management\n- Environmental controls (lighting, temperature)\n\nIntegration Points:\n- Real-time status updates via WebSocket\n- Voice commands through A.L.E.C. voice interface\n- Context-aware automation based on user preferences`,
        source: 'Smart_Home_System',
        confidence: 0.9,
        updated_by: 'system'
      },
      {
        topic: 'AI_Model_Info',
        content: `A.L.E.C. operates using advanced AI models for optimal performance:\n\nCurrent Model Configuration:\n- Base Model: Qwen3.5-35B-A3B via LM Studio\n- Context Window: 16,384 tokens\n- Inference Engine: Local LLM deployment\n- Adaptation: Continuous learning from interactions\n\nLearning Mechanism:\n- Training data collected from user queries and responses\n- Confidence scoring tracks knowledge reliability\n- Automatic model updates when sufficient training accumulated\n- Version tracking for audit and rollback capabilities`,
        source: 'AI_Model_Config',
        confidence: 0.95,
        updated_by: 'system'
      },
      {
        topic: 'User_Authentication',
        content: `A.L.E.C. uses JWT-based authentication for secure access:\n\nToken Types:\n- FULL_CAPABILITIES - Complete system access including neural training and GitHub API\n- LIMITED_ACCESS - Restricted functionality based on user role\n\nAuthentication Flow:\n1. User requests token via POST /api/tokens/generate\n2. System validates credentials and issues JWT\n3. Subsequent requests use Authorization: Bearer <token>\n4. Token expiration enforced for security\n\nAdmin Account:\n- Primary admin: arovner@stoagroup.com\n- Full system access with elevated privileges`,
        source: 'Authentication_System',
        confidence: 1.0,
        updated_by: 'system'
      },
      {
        topic: 'Document_Processing',
        content: `A.L.E.C. supports comprehensive document analysis for STOA Group:\n\nSupported Formats:\n- PDF documents (text extraction and analysis)\n- Plain text files (.txt, .md)\n- Code files with syntax-aware processing\n\nProcessing Capabilities:\n- Content extraction and summarization\n- Keyword identification and tagging\n- Contextual understanding of document purpose\n- Integration with knowledge base for cross-referencing\n\nAPI Access:\n- POST /api/documents/upload - Upload documents for analysis\n- Requires authentication token\n- Returns structured analysis results`,
        source: 'Document_Processor',
        confidence: 0.9,
        updated_by: 'system'
      }
    ];

    // Insert or update each knowledge item
    let insertedCount = 0;
    for (const knowledge of stoaKnowledge) {
      const result = await db.updateStoaKnowledge(knowledge);
      if (result) {
        console.log(`✅ Loaded STOA Knowledge: ${knowledge.topic}`);
        insertedCount++;
      } else {
        console.warn(`⚠️  Failed to load STOA Knowledge: ${knowledge.topic}`);
      }
    }

    // Verify the knowledge was loaded
    const stats = await db.getDatabaseStats();

    if (stats) {
      console.log('\n📊 STOA Knowledge Base Status:');
      console.log(`   Unique Topics Loaded: ${stats.uniqueKnowledgeTopics}`);
      console.log(`   Total Training Records: ${stats.totalTrainingRecords}`);
      console.log(`   Model Updates Tracked: ${stats.totalModelUpdates}`);
    }

    console.log('\n✅ STOA Group Knowledge initialization complete!');
    console.log('🧠 A.L.E.C. now has comprehensive understanding of STOA Group context.\n');

  } catch (error) {
    console.error('❌ Error during STOA knowledge initialization:', error.message);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

// Run the initialization
initializeStoaKnowledge().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});