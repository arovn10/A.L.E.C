#!/usr/bin/env node
/**
 * A.L.E.C. Enhanced Home Assistant Voice Integration
 * Full voice implementation with alarms, reminders, and grocery list support
 */

require('dotenv').config();
const WebSocket = require('ws');
const { STOADatabase } = require('../services/stoaDatabase');

class HomeAssistantVoiceIntegrationEnhanced extends require('./home-assistant-voice-integration.js').HomeAssistantVoiceIntegration {
  constructor(options = {}) {
    super(options);
    this.alarms = [];
    this.reminders = [];
    this.groceryList = [];

    console.log('🏠 Enhanced Home Assistant Voice Integration initialized (with alarms, reminders, grocery list)');
  }

  // ==================== ALARM SYSTEM ====================

  async setAlarm(time, label = 'Alarm', repeat = false) {
    try {
      const alarmId = `alarm_${Date.now()}`;

      this.alarms.push({
        id: alarmId,
        time: time, // ISO format or timestamp
        label: label,
        repeat: repeat,
        active: true,
        created_at: new Date().toISOString()
      });

      await this.stoaDb.updateStoaKnowledge({
        topic: `Alarm_${label}_${Date.now()}`,
        content: `Set ${repeat ? 'recurring' : 'one-time'} alarm for ${time}: "${label}"`,
        source: 'voice_command',
        confidence: 0.95,
        updated_by: 'user'
      });

      return {
        success: true,
        message: `Alarm set for ${time}. ${repeat ? 'Will repeat daily.' : ''}`,
        alarm_id: alarmId
      };

    } catch (error) {
      console.error('❌ Failed to set alarm:', error.message);
      return { success: false, message: error.message };
    }
  }

  async cancelAlarm(alarmId = null) {
    try {
      if (!alarmId) {
        // Cancel all alarms
        this.alarms.forEach(alarm => alarm.active = false);
        const count = this.alarms.length;
        this.alarms = [];

        await this.stoaDb.updateStoaKnowledge({
          topic: 'Alarms_Canceled',
          content: `Canceled ${count} alarms`,
          source: 'voice_command',
          confidence: 0.95,
          updated_by: 'user'
        });

        return { success: true, message: `All ${count} alarms canceled` };
      } else {
        // Cancel specific alarm
        const index = this.alarms.findIndex(alarm => alarm.id === alarmId);
        if (index !== -1) {
          const alarmLabel = this.alarms[index].label;
          this.alarms.splice(index, 1);

          await this.stoaDb.updateStoaKnowledge({
            topic: `Alarm_${alarmLabel}_Canceled`,
            content: `Canceled alarm "${alarmLabel}"`,
            source: 'voice_command',
            confidence: 0.95,
            updated_by: 'user'
          });

          return { success: true, message: `Canceled alarm "${alarmLabel}"` };
        } else {
          return { success: false, message: 'Alarm not found' };
        }
      }

    } catch (error) {
      console.error('❌ Failed to cancel alarm:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getActiveAlarms() {
    const active = this.alarms.filter(alarm => alarm.active);

    await this.stoaDb.updateStoaKnowledge({
      topic: 'Alarm_Status',
      content: `${active.length} alarms currently active`,
      source: 'voice_query',
      confidence: 0.95,
      updated_by: 'user'
    });

    return {
      success: true,
      count: active.length,
      alarms: active.map(alarm => ({
        id: alarm.id,
        time: alarm.time,
        label: alarm.label,
        repeat: alarm.repeat
      }))
    };
  }

  // ==================== REMINDER SYSTEM ====================

  async setReminder(text, when = null) {
    try {
      const reminderId = `reminder_${Date.now()}`;

      this.reminders.push({
        id: reminderId,
        text: text,
        scheduled_time: when || new Date().toISOString(),
        completed: false,
        created_at: new Date().toISOString()
      });

      await this.stoaDb.updateStoaKnowledge({
        topic: `Reminder_${Date.now()}`,
        content: text,
        source: 'voice_command',
        confidence: 0.95,
        updated_by: 'user'
      });

      const timeText = when ? ` at ${when}` : '';

      return {
        success: true,
        message: `Reminder set${timeText}: "${text}"`,
        reminder_id: reminderId
      };

    } catch (error) {
      console.error('❌ Failed to set reminder:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getReminders(completed = false) {
    const reminders = completed
      ? this.reminders.filter(r => r.completed)
      : this.reminders.filter(r => !r.completed);

    await this.stoaDb.updateStoaKnowledge({
      topic: 'Reminder_Status',
      content: `${reminders.length} ${completed ? 'completed' : 'active'} reminders`,
      source: 'voice_query',
      confidence: 0.95,
      updated_by: 'user'
    });

    return {
      success: true,
      count: reminders.length,
      reminders: reminders.map(r => ({
        id: r.id,
        text: r.text,
        scheduled_time: r.scheduled_time,
        completed: r.completed
      }))
    };
  }

  async completeReminder(reminderId) {
    try {
      const reminder = this.reminders.find(r => r.id === reminderId);
      if (reminder && !reminder.completed) {
        reminder.completed = true;

        await this.stoaDb.updateStoaKnowledge({
          topic: `Reminder_${reminder.text}_Completed`,
          content: `Completed reminder: ${reminder.text}`,
          source: 'voice_command',
          confidence: 0.95,
          updated_by: 'user'
        });

        return { success: true, message: `Reminder completed: "${reminder.text}"` };
      } else {
        return { success: false, message: reminder ? 'Already completed' : 'Reminder not found' };
      }

    } catch (error) {
      console.error('❌ Failed to complete reminder:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ==================== GROCERY LIST SYSTEM ====================

  async addToGroceryList(item, quantity = null, category = 'general') {
    try {
      const groceryItem = {
        id: `grocery_${Date.now()}`,
        item: item,
        quantity: quantity || '',
        category: category,
        added_at: new Date().toISOString(),
        completed: false
      };

      this.groceryList.push(groceryItem);

      await this.stoaDb.updateStoaKnowledge({
        topic: `Grocery_${item}_${Date.now()}`,
        content: `Added to grocery list: ${quantity ? `${quantity} ${item}` : item}`,
        source: 'voice_command',
        confidence: 0.95,
        updated_by: 'user'
      });

      const fullItem = quantity ? `${quantity} ${item}` : item;

      return {
        success: true,
        message: `Added "${fullItem}" to grocery list`,
        category: category
      };

    } catch (error) {
      console.error('❌ Failed to add to grocery list:', error.message);
      return { success: false, message: error.message };
    }
  }

  async removeFromGroceryList(itemId) {
    try {
      const index = this.groceryList.findIndex(item => item.id === itemId);
      if (index !== -1) {
        const itemName = this.groceryList[index].item;
        this.groceryList.splice(index, 1);

        await this.stoaDb.updateStoaKnowledge({
          topic: `Grocery_${itemName}_Removed`,
          content: `Removed from grocery list: ${itemName}`,
          source: 'voice_command',
          confidence: 0.95,
          updated_by: 'user'
        });

        return { success: true, message: `Removed "${itemName}" from grocery list` };
      } else {
        return { success: false, message: 'Item not found in list' };
      }

    } catch (error) {
      console.error('❌ Failed to remove from grocery list:', error.message);
      return { success: false, message: error.message };
    }
  }

  async getGroceryList(completed = false) {
    const items = completed
      ? this.groceryList.filter(item => item.completed)
      : this.groceryList.filter(item => !item.completed);

    // Group by category
    const grouped = {};
    items.forEach(item => {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push(item);
    });

    await this.stoaDb.updateStoaKnowledge({
      topic: 'Grocery_Status',
      content: `${items.length} items on grocery list`,
      source: 'voice_query',
      confidence: 0.95,
      updated_by: 'user'
    });

    return {
      success: true,
      count: items.length,
      categories: Object.keys(grouped),
      items: grouped
    };
  }

  async clearGroceryList() {
    try {
      const clearedCount = this.groceryList.length;

      await this.stoaDb.updateStoaKnowledge({
        topic: 'Grocery_List_Cleared',
        content: `Cleared grocery list with ${clearedCount} items`,
        source: 'voice_command',
        confidence: 0.95,
        updated_by: 'user'
      });

      this.groceryList = [];

      return { success: true, message: `All ${clearedCount} items cleared from grocery list` };

    } catch (error) {
      console.error('❌ Failed to clear grocery list:', error.message);
      return { success: false, message: error.message };
    }
  }

  // ==================== ENHANCED VOICE COMMAND PARSING ====================

  /** Small talk / greetings — return { success, message } or null to fall through to HA parsing. */
  conversationalReply(lowerCommand) {
    const t = lowerCommand.replace(/\s+/g, ' ').trim();
    if (!t) return null;

    const haLine = this.isConnected
      ? 'Home Assistant is connected — you can ask me to control lights and devices, set alarms or reminders, or manage your grocery list.'
      : 'Home Assistant is not connected right now, so smart-home actions are limited, but I can still chat.';

    if (
      /^(hi|hello|hey|yo|greetings)([!.]*)?\s*$/i.test(t) ||
      /^(good\s+(morning|afternoon|evening))([!.]*)?\s*$/i.test(t) ||
      /^(hi|hello|hey)\s+there([!.]*)?\s*$/i.test(t)
    ) {
      return {
        success: true,
        message: `Hello! I'm A.L.E.C. (Adaptive Learning Executive Coordinator). ${haLine}`,
      };
    }

    if (/(how\s+are\s+you|how('s|s)\s+it\s+going|what'?s\s+up|you\s+ok(ay)?)/i.test(t)) {
      return {
        success: true,
        message:
          "I'm doing well and ready to help. Tell me what you'd like to do — lights, scenes, alarms, reminders, or your shopping list.",
      };
    }

    if (/\b(thanks|thank\s+you|thx|appreciate\s+it)\b/i.test(t) && t.length < 80) {
      return { success: true, message: "You're welcome!" };
    }

    if (/\b(bye|goodbye|see\s+you|later)\b/i.test(t) && t.length < 60) {
      return { success: true, message: "Goodbye! I'll be here when you need me." };
    }

    if (
      /^help\s*[!.]*$/i.test(t) ||
      /what\s+can\s+you\s+do/i.test(t) ||
      /how\s+do\s+i\s+use\s+(you|this)/i.test(t)
    ) {
      return {
        success: true,
        message:
          'Try things like: "turn on the living room lights", "set an alarm for 7am", "set a reminder to call mom", "add milk to my grocery list", or ask "who are you" for my full introduction.',
      };
    }

    return null;
  }

  async executeVoiceCommand(commandText) {
    try {
      const lowerCommand = commandText.toLowerCase();

      const smallTalk = this.conversationalReply(lowerCommand);
      if (smallTalk) return smallTalk;

      // Alarm Commands (Alexa-style)
      if (lowerCommand.includes('set alarm') || lowerCommand.includes('alarm')) {
        return await this.handleAlarmCommands(lowerCommand);
      }

      // Reminder Commands (Alexa-style)
      if (lowerCommand.includes('set reminder') || lowerCommand.includes('reminder')) {
        return await this.handleReminderCommands(lowerCommand);
      }

      // Grocery List Commands (Alexa-style)
      if (lowerCommand.includes('grocery') || lowerCommand.includes('shopping list') ||
          lowerCommand.includes('add to my list')) {
        return await this.handleGroceryListCommands(lowerCommand);
      }

      // Default: smart home + light/climate/media parsing (parent class)
      return await super.executeVoiceCommand(commandText);

    } catch (error) {
      console.error('❌ Failed to execute voice command:', error.message);
      return { success: false, message: error.message };
    }
  }

  handleAlarmCommands(lowerCommand) {
    // "Set an alarm for 7am"
    const setMatch = lowerCommand.match(/set\s+(a|an)?\s*alarm\s+for\s+(\d+[ap]m|\d{1,2}:\d{2}(?:\s*(am|pm))?)?/i);
    if (setMatch) {
      const time = setMatch[2];
      return this.setAlarm(time, 'Alarm');
    }

    // "Set an alarm for 7 o'clock"
    const hourMatch = lowerCommand.match(/set\s+(a|an)?\s*alarm\s+for\s+(\d{1,2})\s*(o'clock|\bhours?)?/i);
    if (hourMatch) {
      return this.setAlarm(`${hourMatch[2]}:00`, 'Alarm');
    }

    // "Cancel my alarm" or "Delete the alarm"
    if (lowerCommand.includes('cancel') || lowerCommand.includes('delete')) {
      const match = lowerCommand.match(/(alarm|alarms?)/);
      if (match) return this.cancelAlarm();
    }

    // "What alarms do I have?" or "Show my alarms"
    if (lowerCommand.includes('what') || lowerCommand.includes('show')) {
      return this.getActiveAlarms();
    }

    return { success: false, message: 'Could not understand alarm command. Try: "Set an alarm for 7am"' };
  }

  handleReminderCommands(lowerCommand) {
    // "Set a reminder to call mom" or "Remind me to call mom at 5pm"
    const textMatch = lowerCommand.match(/reminder\s+(to|for)?\s+(.+)/i);
    if (textMatch) {
      const text = textMatch[2];

      // Check for time specification
      const timeMatch = lowerCommand.match(/at\s+(\d+[ap]m|\d{1,2}:\d{2}(?:\s*(am|pm))?)/i);
      const when = timeMatch ? `${timeMatch[1]} ${timeMatch[3] || ''}` : null;

      return this.setReminder(text.trim(), when);
    }

    // "Show my reminders" or "What are my reminders?"
    if (lowerCommand.includes('show') || lowerCommand.includes('what')) {
      return this.getReminders(false);
    }

    // "Mark reminder as done" or "Complete reminder"
    if (lowerCommand.includes('done') || lowerCommand.includes('complete') ||
        lowerCommand.includes('finish')) {
      const match = lowerCommand.match(/reminder\s+(\d+)/i);
      if (match) return this.completeReminder(`reminder_${match[1]}`);

      // Mark most recent reminder as done
      const recent = this.reminders.find(r => !r.completed);
      if (recent) return this.completeReminder(recent.id);
    }

    return { success: false, message: 'Could not understand reminder command. Try: "Set a reminder to call mom at 5pm"' };
  }

  handleGroceryListCommands(lowerCommand) {
    // "Add milk to my grocery list" or "Add milk to shopping list"
    const addToMatch = lowerCommand.match(/(add|put)\s+(a|an)?\s*(item|product)?\s+(.+)?\s+to\s+(my\s+)?(?:grocery\s+list|shopping\s+list)/i);
    if (addToMatch) {
      const item = addToMatch[4];

      // Check for quantity: "2 gallons of milk" or "3 apples"
      const quantityMatch = lowerCommand.match(/^(\d+(?:\.\d+)?)\s+(\w+)/);
      const quantity = quantityMatch ? `${quantityMatch[1]} ${quantityMatch[2]}` : null;

      // Determine category based on item name
      let category = 'general';
      if (item.toLowerCase().includes('vegetable')) category = 'produce';
      else if (item.toLowerCase().includes('fruit')) category = 'produce';
      else if (item.toLowerCase().includes('dairy') || item.toLowerCase().includes('milk') ||
               item.toLowerCase().includes('cheese') || item.toLowerCase().includes('yogurt')) category = 'dairy';
      else if (item.toLowerCase().includes('meat') || item.toLowerCase().includes('chicken') ||
               item.toLowerCase().includes('beef') || item.toLowerCase().includes('pork')) category = 'meat';
      else if (item.toLowerCase().includes('bread') || item.toLowerCase().includes('bakery')) category = 'bakery';

      return this.addToGroceryList(item, quantity, category);
    }

    // "Remove milk from grocery list" or "Take out eggs from shopping list"
    const removeFromMatch = lowerCommand.match(/(remove|take\s+out)\s+(.+)?\s+from\s+(my\s+)?(?:grocery\s+list|shopping\s+list)/i);
    if (removeFromMatch) {
      return this.removeFromGroceryList(removeFromMatch[2]); // Simplified - would need item ID in real impl
    }

    // "Show my grocery list" or "What's on the shopping list?"
    if (lowerCommand.includes('show') || lowerCommand.includes('what')) {
      return this.getGroceryList(false);
    }

    // "Clear my grocery list" or "Empty shopping list"
    if (lowerCommand.includes('clear') || lowerCommand.includes('empty')) {
      return this.clearGroceryList();
    }

    return { success: false, message: 'Could not understand grocery command. Try: "Add milk to my grocery list"' };
  }

  // ==================== WAKE WORD DETECTION ====================

  detectWakeWord(audioStream) {
    // This would integrate with a wake word detection engine like Porcupine or Snowboy
    // For now, we'll implement a simple keyword matcher

    const wakeWords = ['Hey Alec', 'hey alec', 'Alec', 'alec'];

    // In production, this should use actual audio processing
    return (text) => {
      return wakeWords.some(wakeWord => text.toLowerCase().includes(wakeWord.toLowerCase()));
    };
  }

  async processWakeWordCommand(text) {
    const wakeWordPattern = /hey\s*alec|alec/i;

    if (wakeWordPattern.test(text)) {
      // Extract command after wake word
      const commandAfterWakeWord = text.replace(wakeWordPattern, '').trim();

      console.log(`🎤 Wake word detected! Command: "${commandAfterWakeWord}"`);

      await this.stoaDb.saveTrainingData({
        userId: 'voice_user',
        query: `Wake word triggered with: ${text}`,
        response: `Processing command: ${commandAfterWakeWord}`,
        context: {
          wake_word: 'Hey Alec',
          raw_command: text,
          processed_command: commandAfterWakeWord
        },
        confidence_score: 0.95,
        learning_tags: ['wake_word', 'voice_trigger']
      });

      return await this.executeVoiceCommand(commandAfterWakeWord);
    }

    return null; // No wake word detected
  }
}

module.exports = { HomeAssistantVoiceIntegrationEnhanced };