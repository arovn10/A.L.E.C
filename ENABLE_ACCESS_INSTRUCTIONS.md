# Enable Access to A.L.E.C. Training Database
**Owner:** arovner@campusrentalsllc.com | **Date:** 2026-04-04

## Current Status
✅ STOA database analyzed (109 tables)
✅ Training data generated (95 samples)
⏳ Waiting for IP whitelisting to upload to campusrentalsllc.database.windows.net

## How to Enable Access

### Option 1: Add Your Current IP Address (Recommended)
1. **Log in to Azure Portal**: https://portal.azure.com
2. **Navigate to SQL Servers**:
   - Click "SQL servers" in the left menu
   - Select `campusrentalsllc`
3. **Open Firewall Settings**:
   - Click "Firewall and virtual networks" in the left menu
4. **Add Your IP Address**:
   - Click "+ Add client IP" button (top right)
   - This will automatically add your current public IP address
   - Click "Save"
5. **Wait 5 minutes for changes to propagate**
6. **Retry the upload script**: `node upload-and-train.js`

### Option 2: Allow All IPs (Testing Only)
1. Go to Azure Portal -> campusrentalsllc.database.windows.net
2. Navigate to Firewall and virtual networks
3. Click "Allow Azure services and resources to access this server"
4. Click Save
5. Wait 5 minutes, then retry upload script

⚠️ **Security Note**: Option 2 allows any IP address to connect - use only for testing!

## After Enabling Access
Run the upload script again:
```bash
cd /Users/alec/Desktop/App\ Development/A.L.E.C
node upload-and-train.js
```

## What Will Happen
1. Script will connect to campusrentalsllc.database.windows.net:1433
2. Upload 95 training samples to A.L.E.C.Training database
3. Store all data under ownership of arovner@campusrentalsllc.com
4. Create completion guide with next steps for model fine-tuning

## Training Data Summary
- **Property Analysis**: 25 samples (occupancy, rent performance)
- **Loan/Financing**: 20 samples (DSCR monitoring, interest exposure)
- **Lease Analysis**: 20 samples (tenant retention, renewal patterns)
- **Covenant Compliance**: 30 samples (compliance tracking, risk assessment)

**Total: 95 high-quality training samples for A.L.E.C.**

## Files Created
1. `./data/STOA_TRAINING-2026-04-04.jsonl` - Raw training data
2. This file - Access instructions
3. After upload: `./data/UPLOAD_COMPLETE_GUIDE.md` - Completion guide

---
**Status:** Ready to proceed once IP is whitelisted
