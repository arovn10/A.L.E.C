/**
 * Adaptive Learning System - Makes A.L.E.C. grow and improve over time
 *
 * Features:
 * - Learns from user interactions and feedback
 * - Builds personal model of user preferences, communication style
 * - Installs new skills dynamically
 * - Tracks patterns and suggests improvements
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AdaptiveLearning {
  constructor() {
    this.interactionLog = [];
    this.userProfiles = new Map(); // userId -> profile data
    this.installedSkills = new Map(); // skillName -> skill config
    this.detectedPatterns = [];
    this.learningRate = 0.1;
    this.consolidationInterval = 3600000; // 1 hour
    this.lastConsolidation = Date.now();

    this.initializePersistence();
  }

  /**
   * Initialize file-based persistence for learning data
   */
  initializePersistence() {
    const logPath = path.join(__dirname, '../logs/learning.log');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '');
    }

    console.log('🧠 Adaptive Learning System initialized');
  }

  /**
   * Log an interaction for learning
   */
  async logInteraction({ userId, message, timestamp }) {
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      userId,
      message,
      timestamp,
      sentiment: this.analyzeSentiment(message),
      keywords: this.extractKeywords(message)
    };

    this.interactionLog.push(entry);

    // Keep last 1000 interactions in memory
    if (this.interactionLog.length > 1000) {
      this.interactionLog.shift();
    }

    await this.saveInteraction(entry);

    return entry;
  }

  /**
   * Analyze sentiment of user message
   */
  analyzeSentiment(text) {
    const positiveWords = ['great', 'excellent', 'amazing', 'love', 'wonderful', 'perfect'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'disappointing', 'wrong'];

    const lowerText = text.toLowerCase();
    let score = 0;

    positiveWords.forEach(word => {
      if (lowerText.includes(word)) score += 1;
    });

    negativeWords.forEach(word => {
      if (lowerText.includes(word)) score -= 1;
    });

    return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  }

  /**
   * Extract keywords from message for pattern detection
   */
  extractKeywords(text) {
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being'];
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));

    return [...new Set(words)]; // Unique keywords
  }

  /**
   * Save interaction to persistent storage
   */
  async saveInteraction(entry) {
    const logPath = path.join(__dirname, '../logs/learning.log');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  }

  /**
   * Train on user-provided data (emails, texts, documents)
   */
  async trainOnData(data, source) {
    console.log(`📚 Training A.L.E.C. on ${source} data...`);

    // Process and learn from the data
    for (const item of Array.isArray(data) ? data : [data]) {
      const keywords = this.extractKeywords(item.text || item.content || String(item));
      const sentiment = this.analyzeSentiment(item.text || item.content || String(item));

      // Update user profile with new knowledge
      await this.updateUserProfile({
        source,
        keywords,
        sentiment,
        timestamp: Date.now()
      });

      // Detect patterns from this data point
      this.detectPattern(keywords, sentiment);
    }

    console.log(`✅ Training complete - ${Array.isArray(data) ? data.length : 1} items processed`);
  }

  /**
   * Update user profile with new information
   */
  async updateUserProfile({ source, keywords, sentiment, timestamp }) {
    // In production, this would update a vector database or ML model
    console.log(`📊 Updated profile: ${keywords.length} keywords from ${source}`);

    if (!this.userProfiles.has(source)) {
      this.userProfiles.set(source, []);
    }

    this.userProfiles.get(source).push({
      keywords,
      sentiment,
      timestamp
    });

    // Consolidate learning periodically
    this.consolidateLearning();
  }

  /**
   * Detect patterns in user behavior and preferences
   */
  detectPattern(keywords, sentiment) {
    const pattern = {
      id: crypto.randomBytes(4).toString('hex'),
      keywords,
      sentiment,
      timestamp: Date.now(),
      frequency: 1
    };

    this.detectedPatterns.push(pattern);

    // Consolidate similar patterns
    this.consolidatePatterns();

    return pattern;
  }

  /**
   * Consolidate detected patterns to avoid redundancy
   */
  consolidatePatterns() {
    if (this.detectedPatterns.length < 10) return;

    const consolidated = [];

    for (const pattern of this.detectedPatterns) {
      let merged = false;

      for (const existing of consolidated) {
        const overlap = pattern.keywords.filter(k => existing.keywords.includes(k)).length;
        if (overlap > 2 && existing.sentiment === pattern.sentiment) {
          // Merge patterns
          existing.frequency++;
          existing.keywords = [...new Set([...existing.keywords, ...pattern.keywords])];
          merged = true;
          break;
        }
      }

      if (!merged) {
        consolidated.push(pattern);
      }
    }

    this.detectedPatterns = consolidated.slice(-50); // Keep last 50 unique patterns
  }

  /**
   * Consolidate learning data periodically
   */
  consolidateLearning() {
    const now = Date.now();
    if (now - this.lastConsolidation < this.consolidationInterval) return;

    console.log('🔄 Consolidating learning data...');

    // Save all interaction logs to disk
    const logPath = path.join(__dirname, '../logs/learning_consolidated.json');
    fs.writeFileSync(logPath, JSON.stringify({
      interactions: this.interactionLog,
      patterns: this.detectedPatterns,
      timestamp: now
    }));

    this.lastConsolidation = now;
  }

  /**
   * Get personality profile for a user
   */
  getPersonalityProfile(userId) {
    const userProfile = Array.from(this.userProfiles.values())
      .flat()
      .reduce((acc, curr) => ({
        ...acc,
        keywords: [...acc.keywords, ...curr.keywords],
        sentimentScores: [...acc.sentimentScores, curr.sentiment]
      }), { keywords: [], sentimentScores: [] });

    // Calculate personality traits based on patterns
    const positiveCount = userProfile.sentimentScores.filter(s => s === 'positive').length;
    const total = userProfile.sentimentScores.length;

    return {
      communicationStyle: this.inferCommunicationStyle(userProfile.keywords),
      sentimentTendency: total > 0 ? (positiveCount / total) : 0.5,
      interests: userProfile.keywords.slice(0, 10),
      activityLevel: this.interactionLog.filter(i => i.userId === userId).length
    };
  }

  /**
   * Infer user's communication style from keywords and patterns
   */
  inferCommunicationStyle(keywords) {
    if (keywords.includes('project') || keywords.includes('deadline')) {
      return 'task-oriented';
    } else if (keywords.includes('idea') || keywords.includes('creative')) {
      return 'exploratory';
    } else if (keywords.includes('detail') || keywords.includes('analysis')) {
      return 'analytical';
    } else {
      return 'balanced';
    }
  }

  /**
   * Initialize A.L.E.C. with personal data
   */
  async initializePersonalData({ userId, emails, texts, documents }) {
    console.log(`🎯 Initializing personal learning for user ${userId}`);

    // Process each data source
    if (emails && Array.isArray(emails)) {
      await this.trainOnData(
        emails.map(e => ({ text: e.body || e.subject, source: 'email' })),
        'emails'
      );
    }

    if (texts && Array.isArray(texts)) {
      await this.trainOnData(
        texts.map(t => ({ text: t.content, source: 'text' })),
        'texts'
      );
    }

    if (documents && Array.isArray(documents)) {
      await this.trainOnData(
        documents.map(d => ({ text: d.content || d.text, source: 'document' })),
        'documents'
      );
    }

    console.log('✅ Personal learning initialization complete');
  }

  /**
   * Install new skills dynamically
   */
  async installSkill(skillName, url) {
    console.log(`🔧 Installing skill: ${skillName}`);

    try {
      // In production, download and validate the skill package
      const skillConfig = {
        name: skillName,
        version: '1.0.0',
        installedAt: Date.now(),
        status: 'active'
      };

      this.installedSkills.set(skillName, skillConfig);

      // Save to disk
      await this.saveInstalledSkills();

      console.log(`✅ Skill ${skillName} installed successfully`);
      return true;
    } catch (error) {
      console.error('Skill installation failed:', error);
      return false;
    }
  }

  /**
   * Save installed skills to disk
   */
  async saveInstalledSkills() {
    const skillPath = path.join(__dirname, '../data/installed_skills.json');
    fs.writeFileSync(skillPath, JSON.stringify(
      Object.fromEntries(this.installedSkills),
      null,
      2
    ));
  }

  /**
   * Get list of installed skills
   */
  async getInstalledSkills() {
    return Array.from(this.installedSkills.entries()).map(([name, config]) => ({
      name,
      ...config
    }));
  }

  /**
   * Suggest improvements based on learned patterns
   */
  suggestImprovements(userId) {
    const userInteractions = this.interactionLog.filter(i => i.userId === userId);
    const recentPatterns = this.detectedPatterns.slice(-10);

    const suggestions = [];

    // Analyze interaction frequency
    if (userInteractions.length < 5) {
      suggestions.push('📈 You\'re just getting started! Try asking more questions to help me learn your needs.');
    }

    // Detect common topics and offer related assistance
    const topicKeywords = {};
    userInteractions.forEach(i => {
      i.keywords.forEach(k => {
        topicKeywords[k] = (topicKeywords[k] || 0) + 1;
      });
    });

    const topTopics = Object.entries(topicKeywords)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    if (topTopics.length > 0) {
      suggestions.push(`💡 I notice you often discuss ${topTopics.map(t => t[0]).join(', ')}. How can I help with these areas?`);
    }

    // Suggest proactive actions based on patterns
    const eveningInteractions = userInteractions.filter(i => {
      const hour = new Date(i.timestamp).getHours();
      return hour >= 18 || hour <= 6;
    });

    if (eveningInteractions.length > userInteractions.length * 0.3) {
      suggestions.push('🌙 I notice you often interact with me in the evenings. Would you like me to prepare a daily summary for tomorrow morning?');
    }

    return suggestions;
  }
}

module.exports = { AdaptiveLearning };
