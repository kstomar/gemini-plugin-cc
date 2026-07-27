---
description: Transfer the current Claude Code session context to a Gemini session
argument-hint: ""
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" transfer "$ARGUMENTS"`

Present the command output to the user exactly as returned.
