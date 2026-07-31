#!/usr/bin/env bash
#
# Builds/rebuilds the double-clickable Desktop launcher app from
# scripts/launcher.applescript. Re-run this any time that file changes; it's safe
# to run repeatedly — osacompile overwrites the existing .app in place.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${HOME}/Desktop/Financial Planning.app"

osacompile -o "${OUT}" "${REPO_DIR}/scripts/launcher.applescript"

echo "Launcher written to: ${OUT}"
