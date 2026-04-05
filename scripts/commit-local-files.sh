#!/usr/bin/env bash
# commit-local-files.sh — Stage and commit all untracked local files that
# should be versioned. Run this on your Mac after pulling the latest
# .gitignore update.
#
# Usage:  ./scripts/commit-local-files.sh
set -euo pipefail

echo "==> Staging files for commit..."

# ── Documentation ────────────────────────────────────────────────
git add \
  .gitattributes \
  ENABLE_ACCESS_INSTRUCTIONS.md \
  FEATURES.md \
  MCP_README.md \
  PERSISTENT_LEARNING_SUMMARY.md \
  QUICK_START.md \
  SETUP_GUIDE.md \
  data/STOA_ANALYSIS_GUIDE.md

# ── Backend code (MCP + middleware) ──────────────────────────────
git add \
  backend/authMiddleware.js \
  backend/mcp/ \
  backend/voiceServer.js

# ── Config ───────────────────────────────────────────────────────
git add \
  config/ \
  data/fine-tune-configs/

# ── Frontend ─────────────────────────────────────────────────────
git add \
  frontend/voice.html

# ── Knowledge base ───────────────────────────────────────────────
git add \
  data/knowledge/

# ── Docs, extensions, tests ──────────────────────────────────────
git add \
  docs/ \
  extensions/ \
  tests/

# ── Scripts (utilities) ──────────────────────────────────────────
git add \
  scripts/analyze-stoa-database.js \
  scripts/azure-firewall-config.sh \
  scripts/comprehensive-stoa-analysis-and-training.sh \
  scripts/create-local-db.js \
  scripts/create-training-data.js \
  scripts/generate-stoa-training-data.js \
  scripts/init-local-database.js \
  scripts/init-stoa-knowledge.js \
  scripts/setup-cloud-ready.sh \
  scripts/setup-local-database.sh \
  scripts/start-with-azure.sh \
  scripts/sync-memory.js \
  scripts/test-local-database.js \
  scripts/test-stoa-knowledge.js \
  start.sh \
  test_api.sh

# ── Legacy services (keep for reference) ─────────────────────────
git add \
  api/storage.js \
  services/RemoteDataFetcher.js \
  services/StorageAdapter.js \
  services/audioEngine.js \
  services/conversationManager.js \
  services/documentProcessor.js \
  services/integrationManager.js \
  services/localDatabase.js \
  services/localLLMService.js \
  services/localNeuralModel.js \
  services/personalityEngine.js \
  services/stoaDatabase.js

# ── Standalone scripts ───────────────────────────────────────────
git add \
  analyze-stoa-complete.js \
  analyze-stoa-fixed.js \
  analyze-stoa-only.js \
  gen-data.js \
  generate-training-data.js \
  index.js \
  server.js \
  fix_syntax_error.py \
  upload-and-train.js \
  upload-to-alec-db.js

echo "==> Creating commit..."
git commit -m "feat: commit local files — docs, MCP backend, training configs, legacy services"

echo "==> Pushing to origin/main..."
git push origin main

echo "==> Done! All local files have been committed and pushed."
