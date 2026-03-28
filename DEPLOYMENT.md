# A.L.E.C. - Deployment Guide

## 🎯 Overview

A.L.E.C. (Adaptive Learning Executive Coordinator) is your personal AI assistant trained on your data, language, and thought processes. Like JARVIS from Iron Man, but smarter and more personal.

---

## 🚀 Quick Start

### Local Development (Mac)

1. **Clone the repository:**
```bash
git clone https://github.com/arovn10/A.L.E.C.git
cd A.L.E.C
```

2. **Run setup script:**
```bash
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh
```

3. **Access the interface:**
- Frontend: http://localhost:3001
- API: http://localhost:3001/api/chat
- Voice WebSocket: ws://localhost:3001/voice

---

## 📋 Prerequisites

### For Local Development (Mac)
- Node.js 18+
- npm or yarn
- Apple Silicon Mac with at least 16GB RAM (recommended for local LLM)

### For Production Deployment (Render.com)
- Render account
- Docker installed locally (optional, for building images)

---

## 🧠 Neural Network Configuration

### Base Model Options

**Option 1: Local LLM (Recommended for Privacy)**
```bash
# Install llama.cpp for local inference
brew install llama-cpp

# Download a quantized model (e.g., Llama-3.1-8B)
# Use GGUF format for best performance on Mac
```

**Option 2: LM Studio Backend**
1. Install [LM Studio](https://lmstudio.ai/)
2. Load a 35B parameter model (e.g., Llama-3.1-70B-Instruct)
3. Start the local server
4. Update `.env`:
```bash
NEURAL_BACKEND=lms-studio
LMS_STUDIO_URL=http://localhost:1234/v1
```

**Option 3: Cloud API (Anthropic/Claude)**
```bash
# Set in .env
ANTHROPIC_API_KEY=your-api-key-here
NEURAL_BACKEND=anthropic
```

---

## 🔐 Token System

A.L.E.C. uses a dual-token system for access control:

### STOA Access Token (Limited)
- Access to STOA financial data only
- Basic chat capabilities
- No smart home access
- Limited neural training permissions

### Full Capabilities Token (Complete)
- All features unlocked
- Smart home integration
- Neural network training
- Voice interface access
- Proactive suggestions and initiative mode

**Generate tokens via the Settings UI or API:**
```bash
POST /api/tokens/generate
{
  "type": "FULL_CAPABILITIES",
  "userId": "your-user-id"
}
```

---

## 🏠 Smart Home Integration

### Supported Platforms (Coming Soon)
- **Home Assistant** - Full integration with automations
- **Apple HomeKit** - Siri-compatible control
- **Google Home** - Voice commands through A.L.E.C.
- **IoT Devices** - Custom device support

### Setup Example (Home Assistant)
```javascript
// In the Smart Home Connector service
const config = {
  platform: 'home_assistant',
  url: 'http://homeassistant.local:8123',
  token: 'your-long-lived-access-token'
};

await smartHomeConnector.connect(config);
```

---

## 📊 Training Your Personal Model

### Initial Data Import
A.L.E.C. learns from your personal data to understand your style and preferences:

**Supported Sources:**
- Email (IMAP/Exchange)
- Text Messages (iMessage/SMS export)
- Documents (PDF, Word, Google Docs)
- Chat History (Slack, Discord, etc.)

**Import Process:**
1. Export your data in standard formats
2. Use the Settings UI to connect data sources
3. A.L.E.C. will analyze and learn patterns
4. Continue training through interactions

### Continuous Learning
A.L.E.C. improves over time by:
- Analyzing interaction patterns
- Detecting preferences and communication style
- Adapting personality based on feedback
- Installing new skills dynamically

---

## 🎙️ Voice Interface Setup

### Web Speech API (Browser-based)
Works out of the box in modern browsers:
```javascript
// The frontend automatically detects browser support
if ('webkitSpeechRecognition' in window) {
  // Use built-in browser speech recognition
} else {
  // Fall back to Vosk or other engine
}
```

### Vosk Offline STT (Recommended)
For privacy and offline capability:
```bash
# Install Vosk
pip install vosk

# Download language model
python -m vosk.models.download_model "en-us"
```

---

## 🐳 Docker Deployment

### Build Locally
```bash
docker build -t alec-personal-ai .
docker run -p 3001:3001 -v $(pwd)/data:/app/data alec-personal-ai
```

### Deploy to Render.com

1. **Connect Repository:**
   - Go to https://dashboard.render.com/
   - Click "New +" → "Web Service"
   - Connect your GitHub repo: `arovn10/A.L.E.C`

2. **Configure Service:**
   ```yaml
   Name: alec-api
   Environment: Docker
   Branch: main
   Plan: Pro (for neural network)
   ```

3. **Add Environment Variables:**
   - `JWT_SECRET`: Generate random secure key
   - `NEURAL_MODEL_PATH`: /app/data/models/personal_model.bin
   - `STOA_ACCESS_TOKEN`: Your STOA API token
   - `FULL_CAPABILITIES_TOKEN`: Your full capability token

4. **Deploy:**
   - Click "Advanced" → Enable auto-deploy
   - Render will build and deploy automatically

---

## 📱 iPad Access

### Optimize for iPad:
1. Open http://your-alec-instance.com in Safari
2. Tap Share → "Add to Home Screen"
3. A.L.E.C. will launch as a standalone PWA app

### Voice Controls on iPad:
- Use built-in Siri integration for hands-free operation
- A.L.E.C. can respond to custom Siri phrases via Shortcuts app

---

## 🔧 Troubleshooting

### Server Won't Start
```bash
# Check logs
tail -f logs/error.log

# Verify dependencies
npm install

# Check port availability
lsof -i :3001  # Should show nothing if port is free
```

### Neural Network Not Loading
- Ensure model file exists at specified path
- Check disk space (needs ~20GB for 35B models)
- Verify GPU/CPU compatibility

### Voice Interface Issues
- Browser permissions: Allow microphone access in settings
- HTTPS required for production voice features
- Test with simple commands first

---

## 🛡️ Security Best Practices

1. **Never commit secrets** - Use environment variables
2. **Rotate tokens regularly** - Set expiration dates
3. **Use HTTPS** - Required for voice interfaces and PWA
4. **Rate limiting** - Implement in production
5. **Audit logs** - Monitor all access attempts

---

## 📈 Performance Optimization

### For Local Mac Deployment:
- Use Apple Silicon native builds (M1/M2/M3)
- Enable GPU acceleration via llama.cpp
- Keep 8GB+ RAM available for model loading

### For Render.com Deployment:
- Choose "Pro" plan for neural service
- Use SSD-backed disk for model storage
- Enable CDN caching for static assets

---

## 🤝 Contributing

Contributions welcome! Please read our contribution guidelines before submitting PRs.

**Areas we need help with:**
- Additional smart home platform integrations
- More personality configurations
- Voice interface improvements
- Mobile app development (iOS/Android)

---

## 📞 Support

For issues and questions:
- GitHub Issues: https://github.com/arovn10/A.L.E.C/issues
- Discord Community: [Link coming soon]
- Email: support@alec.ai (placeholder)

---

**Built with ❤️ by you, for your personal use.**

*Remember: A.L.E.C. is designed to be witty and proactive - she's not just a tool, but your intelligent companion!* 🚀
