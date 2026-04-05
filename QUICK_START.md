# A.L.E.C. - Quick Start Guide

## 🚀 Current Status
**FULLY OPERATIONAL** with Real LLM inference! All systems green. ✅

## Server Status Check
```bash
# Verify both servers are running:
lsof -i :3001 | grep LISTEN  # Main server (Express)
lsof -i :8089 | grep LISTEN  # llama.cpp server
```

## Health Check
```bash
curl http://localhost:3001/health | jq .neuralModel.mode
# Expected output: "real-llm"
```

## API Usage Examples

### Generate Token (Full Capabilities)
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/tokens/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"FULL_CAPABILITIES","userId":"alec_2026"}' | jq -r .token)

echo $TOKEN
```

### Chat with A.L.E.C.
```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello! Who are you and what can you do?"}' | jq .response
```

### Generate STOA Access Token (for data access)
```bash
STOA_TOKEN=$(curl -s -X POST http://localhost:3001/api/tokens/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"STOA_ACCESS","userId":"alec_2026"}' | jq -r .token)

echo $STOA_TOKEN
```

## Testing Real LLM Response
A.L.E.C. is now responding with actual AI-generated content, not mock responses! Try:
```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{"message":"Explain quantum computing in simple terms"}' | jq .response
```

## Personality Traits (Customizable)
- **Sass**: 70% (witty, slightly sarcastic)
- **Initiative**: 60% (proactive suggestions)
- **Empathy**: 80% (emotional intelligence)
- **Creativity**: 50% (balanced creativity)
- **Precision**: 90% (highly accurate responses)

## File Locations
- **Model**: `/Users/alec/Desktop/App Development/A.L.E.C/data/models/personal_model.gguf`
- **Logs**: `/tmp/altec_startup.log` and `/tmp/llama_server.log`
- **Memory Sync**: `scripts/sync-memory.js` (run after each session)

## Troubleshooting

### Server not running?
```bash
# Restart main server
lsof -ti :3001 | xargs kill -9
cd /Users/alec/Desktop/App\ Development/A.L.E.C && npm start

# If llama-server stopped, restart it:
lsof -ti :8089 | xargs -r kill -9
/opt/homebrew/bin/llama-server \
  --model /Users/alec/Desktop/App\ Development/A.L.E.C/data/models/personal_model.gguf \
  --port 8089 \
  --ctx-size 8192 \
  --n-gpu-layers 0 \
  --threads 4 \
  --host 127.0.0.1
```

### Token validation failing?
Make sure you're using a token generated from the API endpoint, not manually created JWTs.

### llama-server won't start?
Check that:
1. Model file exists at correct path
2. `/opt/homebrew/bin/llama-server` binary is installed
3. Sufficient system resources available

## Auto-Update System
This project maintains an auto-updating memory. Run after each session:
```bash
cd /Users/alec/Desktop/App\ Development/A.L.E.C
node scripts/sync-memory.js
```

Or simply open a new tab - the sync happens automatically on first access!

## Next Steps
1. ✅ Real LLM working (DONE)
2. ⏳ Web portal token selection UI (NEXT)
3. ⏳ Domo dashboard integration
4. ⏳ Voice interaction refinement
5. ⏳ Context persistence across sessions

---
**Last Updated**: 2026-03-30 14:17 UTC
**Status**: FULLY OPERATIONAL ✅
