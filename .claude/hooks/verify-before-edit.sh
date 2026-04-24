#!/bin/bash
# verify-before-edit.sh
# BLOCKS Edit/Write on source code files unless session-context has been read.
# Tracks state in a temp file — reset each session.
# Smart AI: gate file is /tmp/claude-smart-ai-context-loaded (avoids collision with v1 sessions).

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)

# Only enforce for source code files
if ! echo "$FILE_PATH" | grep -qE '^(app/|lib/|components/)'; then
  exit 0  # Allow non-source edits (config, docs, memory, scripts)
fi

STATE_FILE="/tmp/claude-smart-ai-context-loaded"

# Check if context was loaded this session
if [ -f "$STATE_FILE" ]; then
  exit 0  # Context loaded — allow edit
fi

# BLOCK the edit
cat <<'BLOCK'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: You have not loaded Smart AI system context yet. Before editing ANY source code, you MUST first: (1) Read smart-ai-td-ops-architecture sysdoc from Smart AI Supabase (tapbgvbglqacamhayfel) via Management API, (2) Read smart-ai-td-ops-stage-0-worklist, (3) Read the relevant code you're about to change. After reading the architecture sysdoc, run: touch /tmp/claude-smart-ai-context-loaded — then your edits will be allowed."}}
BLOCK
