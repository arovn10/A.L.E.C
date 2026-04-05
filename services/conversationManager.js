/**
 * A.L.E.C. - Autonomous Learning Entity Console
 * Services: ConversationManager.js
 * 
 * Manages conversation history, context, and session state
 */

class ConversationManager {
  constructor() {
    this.sessions = new Map();
    this.maxHistoryLength = 50;
  }

  /**
   * Initialize or get a conversation session
   */
  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: new Date().toISOString(),
        history: [],
        context: {},
        metadata: {}
      });
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Add message to conversation history
   */
  addMessage(sessionId, role, content, metadata = {}) {
    const session = this.getSession(sessionId);
    
    if (session.history.length >= this.maxHistoryLength) {
      // Remove oldest messages to maintain limit
      session.history.shift();
    }

    session.history.push({
      id: Date.now(),
      role,
      content,
      timestamp: new Date().toISOString(),
      ...metadata
    });

    return session;
  }

  /**
   * Get conversation history with context window
   */
  getHistory(sessionId, limit = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    return limit 
      ? session.history.slice(-limit) 
      : session.history;
  }

  /**
   * Update session context
   */
  updateContext(sessionId, key, value) {
    const session = this.getSession(sessionId);
    session.context[key] = value;
    return session;
  }

  /**
   * Get context value
   */
  getContextValue(sessionId, key, defaultValue = null) {
    const session = this.sessions.get(sessionId);
    if (!session || !(key in session.context)) {
      return defaultValue;
    }
    return session.context[key];
  }

  /**
   * Clear conversation history for a session
   */
  clearHistory(sessionId) {
    const session = this.getSession(sessionId);
    session.history = [];
    session.context = {};
    return session;
  }

  /**
   * Get all active sessions (for monitoring)
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      createdAt: s.createdAt,
      messageCount: s.history.length,
      contextKeys: Object.keys(s.context).length
    }));
  }

  /**
   * Get session statistics
   */
  getStats() {
    return {
      totalSessions: this.sessions.size,
      maxHistoryLength: this.maxHistoryLength,
      activeSessionIds: Array.from(this.sessions.keys())
    };
  }
}

// Export singleton instance (CommonJS)
module.exports = new ConversationManager();
