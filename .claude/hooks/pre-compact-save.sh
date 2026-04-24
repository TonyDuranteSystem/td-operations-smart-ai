#!/usr/bin/env bash
# Pre-compaction auto-save: captures concrete session state BEFORE context is lost
# Saves: git log, git status, tool count, timestamp — so recovery is possible
# Smart AI: posts to tapbgvbglqacamhayfel session_checkpoints via REST API.
set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://tapbgvbglqacamhayfel.supabase.co}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Gather git state
GIT_LOG=""
GIT_STATUS=""
if [ -d "$REPO_DIR/.git" ]; then
  GIT_LOG=$(cd "$REPO_DIR" && git log --oneline -5 2>/dev/null || echo "unavailable")
  GIT_STATUS=$(cd "$REPO_DIR" && git status --short 2>/dev/null || echo "unavailable")
fi

# Get tool call count
COUNTER_FILE=$(ls /tmp/claude-smart-ai-counter-* 2>/dev/null | head -1)
TOOL_COUNT=0
if [ -n "$COUNTER_FILE" ] && [ -f "$COUNTER_FILE" ]; then
  TOOL_COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
fi

# Escape for JSON
GIT_LOG_ESC=$(echo "$GIT_LOG" | head -5 | tr '\n' ' | ' | sed 's/"/\\"/g' | head -c 500)
GIT_STATUS_ESC=$(echo "$GIT_STATUS" | head -10 | tr '\n' ' | ' | sed 's/"/\\"/g' | head -c 500)

# If no key available, output warning and exit
if [ -z "$SUPABASE_KEY" ]; then
  echo "🔴 COMPACTION IMMINENT — Cannot auto-save (no SUPABASE_SERVICE_ROLE_KEY)."
  echo "SAVE MANUALLY NOW via Management API curl to Smart AI sandbox dev_task 2bc839aa!"
  echo "Git state: ${GIT_LOG_ESC}"
  echo "Modified: ${GIT_STATUS_ESC}"
  exit 0
fi

# Insert checkpoint with concrete data
curl -s -X POST "${SUPABASE_URL}/rest/v1/session_checkpoints" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{
    \"summary\": \"PRE-COMPACTION AUTO-SAVE (${TOOL_COUNT} tool calls). Recent commits: ${GIT_LOG_ESC}. Modified files: ${GIT_STATUS_ESC}\",
    \"next_steps\": \"Recovery: (1) Read smart-ai-td-ops-architecture sysdoc from tapbgvbglqacamhayfel via Management API, (2) SELECT from dev_tasks WHERE id='2bc839aa-2e8e-4841-85ff-8a3f304a68c5', (3) git log -10, (4) read this checkpoint for git state at compaction time.\",
    \"session_type\": \"pre-compaction-auto\",
    \"tool_calls_at_save\": ${TOOL_COUNT}
  }" 2>/dev/null

echo "🔴 COMPACTION IMMINENT — Auto-checkpoint saved with git state (${TOOL_COUNT} tool calls, commits: ${GIT_LOG_ESC})."
echo "You MUST NOW save DETAILED progress to Smart AI dev_task 2bc839aa via Management API: specific files changed, decisions made, and PENDING next steps."
exit 0
