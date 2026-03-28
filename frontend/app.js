/**
 * A.L.E.C. - Frontend Application Logic
 * Handles UI interactions, API communication, and real-time updates
 */

// Configuration
const CONFIG = {
  API_URL: 'http://localhost:3001',
  VOICE_WS_URL: 'ws://localhost:3001/voice',
  TOKEN_TYPES: {
    STOA_ACCESS: 'STOA_ACCESS',
    FULL_CAPABILITIES: 'FULL_CAPABILITIES'
  },
  currentTokenType: null,
  currentToken: null
};

// State Management
const state = {
  messages: [],
  isListening: false,
  voiceConnection: null,
  settings: {
    sassLevel: 0.7,
    initiativeMode: true,
    personality: 'companion'
  }
};

// DOM Elements
const elements = {
  chatMessages: document.getElementById('chatMessages'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  voiceBtn: document.getElementById('voiceBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  sidebar: document.getElementById('sidebar'),
  settingsModal: document.getElementById('settingsModal'),
  welcomeMessage: document.getElementById('welcomeMessage')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

async function initializeApp() {
  console.log('🚀 Initializing A.L.E.C. Frontend...');

  // Check for existing token
  const savedToken = localStorage.getItem('alec_token');
  if (savedToken) {
    CONFIG.currentToken = JSON.parse(savedToken);
    updateTokenUI();
  }

  // Setup event listeners
  setupEventListeners();

  // Initialize voice interface if available
  await initializeVoiceInterface();

  // Load user settings
  loadSettings();

  console.log('✅ A.L.E.C. Frontend ready');
}

function setupEventListeners() {
  // Send message on Enter (Shift+Enter for new line)
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Send button click
  elements.sendBtn.addEventListener('click', sendMessage);

  // Voice button toggle
  elements.voiceBtn.addEventListener('click', toggleVoiceMode);

  // Settings modal
  elements.settingsBtn.addEventListener('click', () => {
    elements.settingsModal.classList.remove('hidden');
  });

  document.getElementById('closeSettings').addEventListener('click', () => {
    elements.settingsModal.classList.add('hidden');
  });

  // Sidebar toggle
  const closeSidebar = document.getElementById('closeSidebar');
  if (closeSidebar) {
    closeSidebar.addEventListener('click', () => {
      elements.sidebar.classList.remove('active');
    });
  }

  // Settings sliders
  document.getElementById('sassLevel').addEventListener('input', updateSassSetting);
  document.getElementById('initiativeLevel').addEventListener('input', updateInitiativeSetting);

  // Token generation buttons
  document.getElementById('generateSTOAToken').addEventListener('click', () => generateToken(CONFIG.TOKEN_TYPES.STOA_ACCESS));
  document.getElementById('generateFullToken').addEventListener('click', () => generateToken(CONFIG.TOKEN_TYPES.FULL_CAPABILITIES));
}

async function sendMessage() {
  const message = elements.messageInput.value.trim();
  if (!message || !CONFIG.currentToken) return;

  // Add user message to chat
  addMessage(message, 'user');
  elements.messageInput.value = '';

  try {
    // Show loading state
    showLoadingIndicator();

    const response = await fetch(`${CONFIG.API_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.currentToken.token}`
      },
      body: JSON.stringify({
        message,
        context: {
          userId: CONFIG.currentToken.userId,
          sassLevel: state.settings.sassLevel,
          initiativeMode: state.settings.initiativeMode
        }
      })
    });

    const data = await response.json();

    // Remove loading indicator
    removeLoadingIndicator();

    if (data.success) {
      addMessage(data.response, 'alec', {
        confidence: data.confidence,
        suggestions: data.suggestions
      });

      // Update UI stats
      updateStats(data);
    } else {
      addMessage('Sorry, I encountered an error. Please try again.', 'alec');
    }

  } catch (error) {
    removeLoadingIndicator();
    console.error('Send error:', error);
    addMessage('A.L.E.C. is currently unavailable. Please check your connection.', 'alec');
  }
}

function addMessage(text, sender, metadata = {}) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;

  let contentHtml = `<div class="message-content">${escapeHtml(text)}</div>`;

  if (metadata.confidence !== undefined) {
    contentHtml += `
      <div style="margin-top: 10px; font-size: 12px; color: ${getConfidenceColor(metadata.confidence)}">
        Confidence: ${(metadata.confidence * 100).toFixed(0)}%
      </div>
    `;
  }

  if (metadata.suggestions && metadata.suggestions.length > 0) {
    contentHtml += `
      <div style="margin-top: 15px;">
        <strong>Suggestions:</strong>
        <ul style="margin-top: 8px; padding-left: 20px;">
          ${metadata.suggestions.map(suggestion => `<li>${escapeHtml(suggestion)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  messageDiv.innerHTML = contentHtml;
  elements.chatMessages.appendChild(messageDiv);

  // Scroll to bottom
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

  // Store in state
  state.messages.push({ text, sender, timestamp: Date.now() });
}

function showLoadingIndicator() {
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message alec';
  loadingDiv.id = 'loadingIndicator';
  loadingDiv.innerHTML = `
    <div class="message-content">
      <div style="display: flex; gap: 4px;">
        <div style="width: 8px; height: 8px; background: var(--primary-color); border-radius: 50%; animation: bounce 1s infinite;"></div>
        <div style="width: 8px; height: 8px; background: var(--primary-color); border-radius: 50%; animation: bounce 1s infinite 0.2s;"></div>
        <div style="width: 8px; height: 8px; background: var(--primary-color); border-radius: 50%; animation: bounce 1s infinite 0.4s;"></div>
      </div>
    </div>
  `;
  elements.chatMessages.appendChild(loadingDiv);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function removeLoadingIndicator() {
  const loadingDiv = document.getElementById('loadingIndicator');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

async function initializeVoiceInterface() {
  if (!window.WebSocket) {
    console.warn('WebSocket not supported - voice interface disabled');
    elements.voiceBtn.disabled = true;
    return;
  }

  try {
    state.voiceConnection = new WebSocket(CONFIG.VOICE_WS_URL);

    state.voiceConnection.onopen = () => {
      console.log('🎤 Voice WebSocket connected');
      elements.voiceBtn.disabled = false;
    };

    state.voiceConnection.onmessage = (event) => {
      const data = JSON.parse(event.data);
      handleVoiceMessage(data);
    };

    state.voiceConnection.onerror = (error) => {
      console.error('WebSocket error:', error);
      elements.voiceBtn.disabled = true;
    };

  } catch (error) {
    console.error('Voice interface init failed:', error);
    elements.voiceBtn.disabled = true;
  }
}

function toggleVoiceMode() {
  if (!state.voiceConnection || state.isListening) {
    // Stop listening
    stopVoiceListening();
  } else {
    startVoiceListening();
  }
}

function startVoiceListening() {
  console.log('🎤 Starting voice listening...');
  elements.voiceBtn.textContent = '⏹️';
  elements.voiceVisualizer.classList.remove('hidden');
  state.isListening = true;

  // Send initial message to server
  state.voiceConnection.send(JSON.stringify({ type: 'start_listening' }));
}

function stopVoiceListening() {
  console.log('🔇 Stopping voice listening...');
  elements.voiceBtn.textContent = '🎤';
  elements.voiceVisualizer.classList.add('hidden');
  state.isListening = false;

  if (state.voiceConnection) {
    state.voiceConnection.send(JSON.stringify({ type: 'stop_listening' }));
  }
}

function handleVoiceMessage(data) {
  switch (data.type) {
    case 'welcome':
      console.log('Voice welcome:', data.message);
      break;

    case 'transcript':
      addMessage(`🎤 You said: "${data.text}"`, 'user');
      // Automatically send to A.L.E.C. for processing
      setTimeout(() => {
        state.voiceConnection.send(JSON.stringify({ type: 'forward', text: data.text }));
      }, 500);
      break;

    case 'error':
      console.error('Voice error:', data.message);
      stopVoiceListening();
      break;

    default:
      console.log('Voice message:', data.type, data);
  }
}

function quickAsk(question) {
  elements.welcomeMessage.style.display = 'none';
  elements.messageInput.value = question;
  elements.messageInput.focus();
}

function updateTokenUI() {
  const tokenStatus = document.getElementById('tokenStatus');
  if (CONFIG.currentTokenType === CONFIG.TOKEN_TYPES.STOA_ACCESS) {
    tokenStatus.textContent = '🔒 STOA Access';
    tokenStatus.style.background = 'rgba(6, 182, 212, 0.2)';
  } else if (CONFIG.currentTokenType === CONFIG.TOKEN_TYPES.FULL_CAPABILITIES) {
    tokenStatus.textContent = '✨ Full Capabilities Unlocked';
    tokenStatus.style.background = 'rgba(139, 92, 246, 0.2)';
    elements.voiceBtn.disabled = false;
  }
}

async function generateToken(tokenType) {
  try {
    const response = await fetch(`${CONFIG.API_URL}/api/tokens/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: tokenType })
    });

    const data = await response.json();

    if (data.success) {
      CONFIG.currentToken = data;
      CONFIG.currentTokenType = tokenType;
      localStorage.setItem('alec_token', JSON.stringify(data));

      updateTokenUI();

      // Show success message
      alert(`✅ ${tokenType === CONFIG.TOKEN_TYPES.STOA_ACCESS ? 'STOA' : 'Full'} capabilities activated!`);
    } else {
      throw new Error(data.error || 'Failed to generate token');
    }
  } catch (error) {
    console.error('Token generation failed:', error);
    alert(`❌ Token generation failed: ${error.message}`);
  }
}

function updateSassSetting(e) {
  state.settings.sassLevel = e.target.value / 100;
  document.getElementById('sassValue').textContent = state.settings.sassLevel.toFixed(1);
  saveSettings();
}

function updateInitiativeSetting(e) {
  state.settings.initiativeMode = e.target.value >= 50;
  document.getElementById('initiativeValue').textContent = state.settings.initiativeMode ? '1.0' : '0.0';
  saveSettings();
}

function loadSettings() {
  const savedSettings = localStorage.getItem('alec_settings');
  if (savedSettings) {
    const settings = JSON.parse(savedSettings);
    Object.assign(state.settings, settings);

    // Update UI controls
    document.getElementById('sassLevel').value = state.settings.sassLevel * 100;
    document.getElementById('initiativeLevel').value = state.settings.initiativeMode ? 80 : 20;
    document.getElementById('sassValue').textContent = state.settings.sassLevel.toFixed(1);
    document.getElementById('initiativeValue').textContent = state.settings.initiativeMode ? '1.0' : '0.0';
  }
}

function saveSettings() {
  localStorage.setItem('alec_settings', JSON.stringify(state.settings));
}

function updateStats(data) {
  // Update query count
  const queriesCount = parseInt(document.getElementById('queriesCount').textContent);
  document.getElementById('queriesCount').textContent = queriesCount + 1;

  // Update confidence score
  if (data.confidence !== undefined) {
    const currentConf = parseFloat(document.getElementById('confidenceScore').textContent);
    // Simple averaging - in production use weighted average
    const newConf = ((currentConf * (queriesCount || 0)) + data.confidence) / (queriesCount + 1);
    document.getElementById('confidenceScore').textContent = `${(newConf * 100).toFixed(0)}%`;
  }

  // Show suggestions if available
  if (data.suggestions && data.suggestions.length > 0) {
    updatePatternsCount(data.suggestions.length);
  }
}

function updatePatternsCount(count) {
  const patternsCount = parseInt(document.getElementById('patternsCount').textContent);
  document.getElementById('patternsCount').textContent = patternsCount + count;
}

function getConfidenceColor(confidence) {
  if (confidence >= 0.9) return '#10b981'; // Green
  if (confidence >= 0.7) return '#f59e0b'; // Yellow
  return '#ef4444'; // Red
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Global function for quick ask buttons
window.quickAsk = quickAsk;

console.log('🎯 A.L.E.C. Frontend loaded successfully');
