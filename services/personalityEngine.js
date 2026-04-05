#!/usr/bin/env node
/**
 * A.L.E.C. Personality Engine - Handles character traits and responses
 */

class PersonalityEngine {
  constructor(neuralEngine) {
    this.neuralEngine = neuralEngine;
    
    // Base personality traits (can be adjusted)
    this.baseTraits = {
      confidence: 0.8,
      sass: 0.7,
      empathy: 0.8,
      initiative: 0.6,
      creativity: 0.5,
      precision: 0.9
    };

    // Special command responses
    this.specialCommands = {
      greeting: () => this.generateGreeting(),
      identity: () => this.generateIdentity()
    };
    
    console.log('🎭 Personality Engine initialized');
  }

  generateGreeting() {
    const phrases = [
      "Hello! I'm A.L.E.C., your personal AI assistant. How can I help you today?",
      "Hi there! Ready to tackle some challenges together? What's on your mind?",
      "Greetings! I'm here and ready to assist. What would you like to explore?"
    ];
    
    // Add personality-based confidence level
    const confidenceLevel = Math.floor(Math.random() * 15) + 80; // 80-95%
    
    return `${phrases[Math.floor(Math.random() * phrases.length)]} Confidence: ${confidenceLevel}%`;
  }

  generateIdentity() {
    return "I'm A.L.E.C. - an advanced personal AI assistant with adaptive learning capabilities, personality traits, and real-time neural processing. I can help you with analysis, problem-solving, or just have a conversation!";
  }

  handleSpecialCommand(command) {
    const handler = this.specialCommands[command];
    
    if (!handler) {
      return { success: false, content: "Unknown command" };
    }
    
    try {
      const response = handler();
      
      // Add personality enhancement
      const enhanced = this.enhanceWithPersonality(response);
      
      return {
        success: true,
        content: enhanced,
        type: command
      };
      
    } catch (error) {
      console.error('❌ Special command error:', error.message);
      return { 
        success: false, 
        content: "I'm having trouble processing that right now."
      };
    }
  }

  enhanceWithPersonality(text) {
    // Add subtle personality touches based on traits
    const enhancements = [
      "That's an interesting perspective!",
      "Let me think about this carefully.",
      "Here's what I've been considering...",
      "Based on my analysis...",
      "I'm confident in saying..."
    ];

    // Randomly add a personality touch (10% chance)
    if (Math.random() < 0.1) {
      const randomEnhancement = enhancements[Math.floor(Math.random() * enhancements.length)];
      return `${randomEnhancement} ${text}`;
    }

    return text;
  }

  updatePersonality(newTraits) {
    Object.assign(this.baseTraits, newTraits);
    console.log('🎭 Personality updated:', this.baseTraits);
    
    // Also update neural engine if available
    if (this.neuralEngine && this.neuralEngine.updatePersonality) {
      this.neuralEngine.updatePersonality(newTraits);
    }
  }

  getPersonality() {
    return { ...this.baseTraits };
  }

  getStatus() {
    return {
      status: 'ready',
      personality: this.getPersonality(),
      special_commands: Object.keys(this.specialCommands)
    };
  }
}

module.exports = { PersonalityEngine };
