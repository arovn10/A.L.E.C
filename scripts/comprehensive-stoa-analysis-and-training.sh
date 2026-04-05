#!/bin/bash
set -e

echo "═══════════════════════════════════════════════"
echo "🔍 A.L.E.C. Comprehensive STOA Database Analysis & Training"
echo "   Owner: arovner@campusrentalsllc.com"
echo "═══════════════════════════════════════════════"

# Step 1: Connect to STOA and analyze all tables
echo -e "\n📊 Step 1: Analyzing STOA Group Azure SQL Database..."
cd /Users/alec/Desktop/App\ Development/A.L.E.C
node scripts/analyzer-stoa-all-tables.js

# Step 2: Generate training data from real data
echo -e "\n🔄 Step 2: Generating Training Data from Real STOA Data..."
node scripts/generate-training-data-from-real-data.js

# Step 3: Upload to A.L.E.C. Training database at campusrentalsllc.com
echo -e "\n💾 Step 3: Uploading Training Data to A.L.E.C. Training Database..."
node scripts/upload-to-alec-training-db.js

# Step 4: Start local training
echo -e "\n🚀 Step 4: Starting Local Model Training..."
node scripts/start-local-training.js

echo -e "\n═══════════════════════════════════════════════"
echo "✅ Complete STOA Analysis & Training Pipeline Finished!"
echo "═══════════════════════════════════════════════"
