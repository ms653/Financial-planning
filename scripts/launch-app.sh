#!/usr/bin/env bash
#
# One-click "turn the app on" script, for the desktop launcher (see
# scripts/make-launcher.sh). Deliberately NOT deploy.sh: this starts what's already
# been deployed (docker compose up -d against existing images), it doesn't pull,
# rebuild, or migrate anything. Run ./deploy.sh separately to ship a code change.
#
# Safe to run any time, including when everything's already up — docker compose
# no-ops on an already-running, unchanged stack.

set -euo pipefail

# Covers both Homebrew install locations (Intel /usr/local, Apple Silicon
# /opt/homebrew) and Docker Desktop's own CLI symlinks — needed because this script
# is launched from a double-clicked .app, not an interactive shell, so it can't
# assume .zshrc/.bash_profile ran first.
export PATH="/usr/local/bin:/opt/homebrew/bin:${PATH}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_DIR}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mCouldn'"'"'t start the app: %s\033[0m\n' "$1" >&2; exit 1; }

# --- 1. Docker Desktop -------------------------------------------------------------
step 'Checking Docker'
if ! docker info >/dev/null 2>&1; then
  printf 'Starting Docker Desktop'
  open -a Docker
  for _ in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      printf ' ready\n'
      break
    fi
    printf '.'
    sleep 1
  done
  docker info >/dev/null 2>&1 || fail 'Docker Desktop did not start within 90s — open it manually and try again.'
fi

# --- 2. Bring the stack up ----------------------------------------------------------
step 'Starting the app'
docker compose up -d || fail 'docker compose up failed — check `docker compose logs`.'

# --- 3. Wait for it to actually answer ----------------------------------------------
step 'Waiting for the app to be ready'
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    printf 'Ready.\n'
    open http://localhost:3000
    exit 0
  fi
  sleep 1
done

fail 'the app did not become healthy in time. Check `docker compose logs app`.'
