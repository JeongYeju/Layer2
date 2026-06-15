#!/bin/bash
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
cd "$(dirname "$0")"
codex exec --skip-git-repo-check -s workspace-write \
  -c sandbox_workspace_write.network_access=true \
  "$(cat _codex_instruction.txt)" > _codex_run.log 2>&1
