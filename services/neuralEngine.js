/**
 * A.L.E.C. Neural Engine Bridge
 *
 * Calls the Python FastAPI neural engine on localhost:8000.
 * Replaces the mock LLM with real Qwen2.5-Coder-7B inference.
 */

const NEURAL_URL = `http://localhost:${process.env.NEURAL_PORT || 8000}`;

class NeuralEngine {
  constructor() {
    this.neuralUrl = NEURAL_URL;
    this.modelLoaded = false;
    this.personalityTraits = {
      sass: 0.7,
      initiative: 0.8,
      empathy: 0.9,
      creativity: 0.85,
      precision: 0.95,
    };
    this.stats = {
      queriesProcessed: 0,
      avgConfidence: 0,
      trainingIterations: 0,
    };
  }

  /**
   * Check if the Python neural engine is up and the model is loaded.
   */
  async initialize() {
    try {
      const resp = await fetch(`${this.neuralUrl}/health`);
      const data = await resp.json();
      this.modelLoaded = data.model_loaded === true;
      console.log(
        this.modelLoaded
          ? '🧠 Neural engine connected — model loaded'
          : '⚠️  Neural engine running but model not loaded (run scripts/download-model.sh)'
      );
    } catch {
      console.warn(
        '⚠️  Python neural engine not reachable at', this.neuralUrl,
        '— start it with: cd services/neural && python server.py'
      );
      this.modelLoaded = false;
    }
  }

  /**
   * Send a chat query to the Python neural engine.
   */
  async processQuery({ query, context = {}, personality = 'companion', sassLevel = 0.7, initiativeMode = true }) {
    this.stats.queriesProcessed++;

    // Build messages array
    const messages = [];
    if (context.history && Array.isArray(context.history)) {
      messages.push(...context.history);
    }
    messages.push({ role: 'user', content: query });

    try {
      const resp = await fetch(`${this.neuralUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'alec-local',
          messages,
          temperature: 0.6 + sassLevel * 0.3, // sass -> higher temperature
          max_tokens: 1024,
          session_id: context.sessionId || undefined,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `Neural engine returned ${resp.status}`);
      }

      const data = await resp.json();
      const choice = data.choices?.[0];

      return {
        text: choice?.message?.content || 'I had trouble generating a response.',
        confidence: 0.85,
        personality,
        suggestions: initiativeMode
          ? [
              'Would you like me to analyze your recent data?',
              'Want me to check something in the database?',
              'Shall we kick off a training run?',
            ]
          : [],
        conversationId: data.conversation_id,
        usage: data.usage,
        latencyMs: data.latency_ms,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Neural engine call failed:', error.message);

      // Graceful fallback — tell the user what happened
      return {
        text: `I'm having trouble connecting to my neural engine right now. Error: ${error.message}. Make sure the Python server is running on port ${process.env.NEURAL_PORT || 8000}.`,
        confidence: 0,
        personality,
        suggestions: ['Try running: cd services/neural && python server.py'],
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Submit feedback for a conversation.
   */
  async submitFeedback(conversationId, rating, feedback = '') {
    try {
      const resp = await fetch(`${this.neuralUrl}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          rating,
          feedback,
        }),
      });
      return await resp.json();
    } catch (error) {
      console.error('Feedback submission failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start a LoRA training run.
   */
  async startTraining(dataPath, config) {
    try {
      const resp = await fetch(`${this.neuralUrl}/training/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data_path: dataPath, config }),
      });
      return await resp.json();
    } catch (error) {
      console.error('Training start failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get training status.
   */
  async getTrainingStatus() {
    try {
      const resp = await fetch(`${this.neuralUrl}/training/status`);
      return await resp.json();
    } catch (error) {
      return { is_training: false, error: error.message };
    }
  }

  /**
   * Export rated conversations for training.
   */
  async exportTrainingData() {
    try {
      const resp = await fetch(`${this.neuralUrl}/training/export`, {
        method: 'POST',
      });
      return await resp.json();
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get conversation history from the database.
   */
  async getConversationHistory(limit = 50) {
    try {
      const resp = await fetch(`${this.neuralUrl}/conversations?limit=${limit}`);
      return await resp.json();
    } catch (error) {
      return { conversations: [], error: error.message };
    }
  }

  /**
   * Get model info from the Python engine.
   */
  async getModelInfo() {
    try {
      const resp = await fetch(`${this.neuralUrl}/model/info`);
      return await resp.json();
    } catch {
      return { loaded: false, error: 'Neural engine not reachable' };
    }
  }

  /**
   * Trigger retrain (calls training/start with default config).
   */
  async retrain() {
    this.stats.trainingIterations++;
    return this.startTraining();
  }

  async loadPersonalContext(userId) {
    // Personal context is now managed in the Python engine's database layer
    console.log(`📚 Personal context for ${userId} managed by neural engine DB`);
  }

  getStats() {
    return {
      ...this.stats,
      modelsLoaded: this.modelLoaded ? 1 : 0,
      personalityTraits: this.personalityTraits,
      neuralUrl: this.neuralUrl,
    };
  }

  getModelStatus() {
    return {
      loaded: this.modelLoaded,
      stats: this.stats,
      personality: this.personalityTraits,
      mode: this.modelLoaded ? 'neural' : 'offline',
    };
  }
}

module.exports = { NeuralEngine };
