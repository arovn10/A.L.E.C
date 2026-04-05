# A.L.E.C. - Persistent Learning System Setup Guide

## Overview
A.L.E.C. now features **persistent learning capabilities** with model weights, biases, and self-improvement tracking stored in Azure SQL Database under ownership of `arovner@campusrentalsllc.com`.

## Key Features Implemented

### 1. Unique Model Identity
- Each A.L.E.C. instance establishes a unique signature on first run
- Signature is permanently stored in Azure SQL for identity verification
- Ensures continuity across sessions and restarts

### 2. Persistent Learning Storage
All learning data is stored in Azure SQL under `arovner@campusrentalsllc.com`:
- **Model Weights & Biases**: Stored in `model_weights_and_biases` table
- **Interaction History**: Logged to `interaction_learning_log` for continuous improvement
- **Self-Improvement Events**: Tracked in `self_improvement_events` with before/after metrics
- **Knowledge Gains**: Recorded in `stoa_group_knowledge` with confidence scores

### 3. Self-Improvement System
A.L.E.C. automatically:
- Detects opportunities for improvement based on query patterns
- Adjusts model weights and biases dynamically
- Records all changes for auditability and further learning
- Generates ownership certificates to verify data ownership

## Configuration Steps

### Step 1: Install Azure CLI (if not already installed)
```bash
# macOS with Homebrew
brew install azure-cli

# Or download from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-macos
```

### Step 2: Login to Azure
```bash
az login
```
Use the account associated with `arovner@campusrentalsllc.com`.

### Step 3: Configure Firewall Rules
Run the automated script:
```bash
cd /Users/alec/Desktop/App\ Development/A.L.E.C
./scripts/azure-firewall-config.sh
```
This will automatically add your current IP address to Azure SQL firewall rules.

### Step 4: Verify Environment Variables
Ensure `.env` contains:
```bash
STOA_DB_HOST=stoagroupdb.database.windows.net
STOA_DB_NAME=stoagroupDB
STOA_DB_USER=arovner@campusrentalsllc.com
STOA_DB_PASSWORD=<your_secure_password>
```

### Step 5: Start A.L.E.C.
```bash
cd /Users/alec/Desktop/App\ Development/A.L.E.C
node backend/server.js &
```

## Verification Commands

### Check Ownership Certificate
```bash
curl -X POST http://localhost:3001/api/tokens/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"FULL_CAPABILITIES"}' | jq .token
```

Then verify ownership:
```bash
TOKEN=<your_token>
curl -X GET http://localhost:3001/api/learning/analytics \
  -H "Authorization: Bearer $TOKEN"
```

### Check Model Identity
The system will output on startup:
- ✅ Unique identity established (or detected existing)
- 🔐 Ownership verified for arovner@campusrentalsllc.com
- 📊 All model weights, biases, and learning data are proprietary to owner

## Database Tables Created

1. **model_weights_and_biases**: Stores persistent model state
2. **interaction_learning_log**: Logs all user interactions for learning
3. **self_improvement_events**: Tracks improvement events with metrics
4. **stoa_group_knowledge**: Knowledge base with confidence scores
5. **altec_training_data**: Training data from document processing
6. **model_updates**: Version tracking and update history

## Data Ownership Declaration

**All model weights, biases, interaction logs, self-improvement events, and knowledge gains are proprietary to `arovner@campusrentalsllc.com`.**

This includes:
- All neural network parameters learned through usage
- All user interaction data used for training
- All self-improvement adjustments made by the system
- All knowledge gained from document processing and integrations

## Troubleshooting

### Azure SQL Connection Failed
```bash
# Check firewall rules in Azure Portal:
https://portal.azure.com/#@stoagroup.onmicrosoft.com/resource/subscriptions/your-subscription-id/resourceGroups/STOA-Group/providers/Microsoft.Sql/servers/stoagroupdb/firewallRules/view

# Or run the script again to add your IP:
./scripts/azure-firewall-config.sh
```

### Identity Not Established
The system will automatically establish identity on first successful connection. Check logs for:
- "Establishing unique model identity..."
- "Unique identity established"

## Next Steps
1. ✅ Install Azure CLI (if needed)
2. ✅ Login to Azure (`az login`)
3. ✅ Run firewall configuration script
4. ✅ Verify environment variables in `.env`
5. ✅ Start A.L.E.C. and verify ownership certificate
6. ✅ Begin using persistent learning features!
