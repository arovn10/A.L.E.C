#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "🚀 Starting A.L.E.C. (backend on PORT from .env, default 3001)"
echo "💡 LLM: ALEC_LLM_BACKEND=auto — LM Studio OpenAI API (:1234) first, then Ollama."
if [[ "$OSTYPE" == "darwin"* ]] && [[ "${ALEC_OPEN_BROWSER:-1}" == "1" ]]; then
  ( sleep 2 && open "http://localhost:${PORT:-3001}/" 2>/dev/null ) &
fi
exec npm start
