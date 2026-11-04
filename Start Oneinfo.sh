#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
if ! command -v node >/dev/null 2>&1 && [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.12+ first, then run this launcher again."
  read -r -p "Press Enter to close…"
  exit 1
fi
node scripts/start-local.mjs --pause-on-error
