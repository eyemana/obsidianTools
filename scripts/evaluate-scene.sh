#!/bin/bash
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

TOOLS_ROOT="$HOME/writers/obsidianTools"
SCENE_PATH="$1"

cd "$TOOLS_ROOT"

node "$TOOLS_ROOT/evaluators/evaluate-scene.mjs" "$SCENE_PATH" "$2" "$3"
