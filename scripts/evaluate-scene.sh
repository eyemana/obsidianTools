#!/bin/bash

LOG="/tmp/obsidian-evaluate-scene.log"

{
  echo "----- $(date) -----"

  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null

  VAULT_ROOT="$HOME/writers"
  TOOLS_ROOT="$VAULT_ROOT/obsidianTools"

  SCENE_PATH="$1"
  METRIC="$2"
  TARGET="$3"

  if [[ "$SCENE_PATH" != /* ]]; then
    SCENE_PATH="$VAULT_ROOT/$SCENE_PATH"
  fi

  echo "SCENE_PATH=$SCENE_PATH"
  echo "METRIC=$METRIC"
  echo "TARGET=$TARGET"

  cd "$TOOLS_ROOT"

  node \
    "$TOOLS_ROOT/evaluators/evaluate-scene.mjs" \
    "$SCENE_PATH" \
    "$METRIC" \
    "$TARGET"

  EXIT_CODE=$?

  echo "EXIT_CODE=$EXIT_CODE"
  exit $EXIT_CODE
} >> "$LOG" 2>&1