#!/usr/bin/env bash
#
# Deploy runbook.
#
#   ./deploy.sh
#
# Ordering is the whole point of this script, from PROPOSAL.md's Local-first
# architecture section:
#
#   git pull -> docker compose build -> pg_dump -> run migrations -> docker compose up -d
#
# The dump comes BEFORE the migration and that ordering is deliberate: Drizzle
# migrations here are forward-only, so the pre-migration dump IS the rollback mechanism.
# Reordering these two steps means a migration that corrupts or drops data has no
# recovery path. Do not "tidy" this by moving the dump later or making it conditional.
#
# Safe to re-run. Every step aborts the deploy on failure rather than continuing.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${REPO_DIR}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31mDeploy aborted: %s\033[0m\n' "$1" >&2; exit 1; }

# --- 0. Preflight -------------------------------------------------------------------
step 'Preflight'

[ -f .env ] || fail '.env is missing. Copy .env.example and fill it in (see docs/DEPLOYMENT.md).'

# shellcheck disable=SC1091
set -a && . ./.env && set +a

for required in POSTGRES_PASSWORD APP_PASSPHRASE_HASH SESSION_SECRET; do
  if [ -z "${!required:-}" ]; then
    fail "${required} is not set in .env"
  fi
done

case "${APP_PASSPHRASE_HASH}" in
  '$argon2id$'*) ;;
  # Catches the plaintext-in-env mistake here, at deploy time, rather than as an app
  # nobody can log into. src/lib/auth/passphrase.ts enforces the same rule at runtime.
  *) fail 'APP_PASSPHRASE_HASH is not an argon2id hash. Generate one with `npm run passphrase:hash`.' ;;
esac

if [ "${#SESSION_SECRET}" -lt 32 ]; then
  fail 'SESSION_SECRET must be at least 32 characters. Generate one with `openssl rand -base64 48`.'
fi

command -v docker >/dev/null 2>&1 || fail 'docker is not installed'
docker compose version >/dev/null 2>&1 || fail 'the docker compose plugin is not available'

if [ -n "$(git status --porcelain)" ]; then
  printf 'Working tree has uncommitted changes. Continue anyway? [y/N] '
  read -r reply
  case "${reply}" in [yY]*) ;; *) fail 'stopped at your request' ;; esac
fi

# --- 1. Pull ------------------------------------------------------------------------
step 'git pull'
git pull --ff-only || fail 'git pull failed (not a fast-forward? resolve manually)'

# --- 2. Build -----------------------------------------------------------------------
# Before the dump, so a broken build fails the deploy without having touched the
# database at all.
step 'docker compose build'
docker compose build || fail 'docker compose build failed'

# --- 3. Pre-migration safety dump ---------------------------------------------------
step 'Pre-migration safety dump'

# The db container must be up to dump it; bringing up just `db` leaves the old app
# running and serving, which is the correct state for a dump.
docker compose up -d db || fail 'could not start the database container'

printf 'Waiting for Postgres to accept connections'
for _ in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U "${POSTGRES_USER:-postgres}" \
      -d "${POSTGRES_DB:-financial_planning}" >/dev/null 2>&1; then
    printf ' ready\n'
    break
  fi
  printf '.'
  sleep 2
done

docker compose exec -T db pg_isready -U "${POSTGRES_USER:-postgres}" \
  -d "${POSTGRES_DB:-financial_planning}" >/dev/null 2>&1 \
  || fail 'Postgres did not become ready — refusing to migrate without a dump'

PRE_MIGRATION_DIR="${BACKUP_DIR:-./backups}/pre-migration"
mkdir -p "${PRE_MIGRATION_DIR}"
DUMP_FILE="${PRE_MIGRATION_DIR}/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).sql"

docker compose exec -T db pg_dump \
  --username "${POSTGRES_USER:-postgres}" \
  --dbname "${POSTGRES_DB:-financial_planning}" \
  --format=plain --no-owner --no-privileges \
  > "${DUMP_FILE}" || fail 'pg_dump failed — NOT running migrations'

[ -s "${DUMP_FILE}" ] || fail 'pg_dump produced an empty file — NOT running migrations'

printf 'Safety dump written: %s (%s bytes)\n' "${DUMP_FILE}" "$(wc -c < "${DUMP_FILE}" | tr -d ' ')"
printf 'Note: this dump is UNENCRYPTED and local. It is a rollback artefact for the next\n'
printf '      few minutes, not a backup — scripts/backup.sh is the backup.\n'

# --- 4. Migrate ---------------------------------------------------------------------
step 'Run pending Drizzle migrations'
# One-shot container from the `tools` profile; drizzle-kit is a devDependency and is not
# in the runtime image. See the migrator stage in Dockerfile.
docker compose run --rm migrate \
  || fail "migrations failed. The pre-migration dump is at ${DUMP_FILE} — see docs/DEPLOYMENT.md for the restore procedure."

# --- 5. Up --------------------------------------------------------------------------
step 'docker compose up -d'
docker compose up -d --remove-orphans || fail 'docker compose up failed'

# --- 6. Verify ----------------------------------------------------------------------
step 'Health check'
printf 'Waiting for the app'
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    printf ' ok\n'
    curl -fsS http://127.0.0.1:3000/api/health; printf '\n'
    printf '\nDeployed. Reachable over Tailscale — see docs/DEPLOYMENT.md.\n'
    exit 0
  fi
  printf '.'
  sleep 2
done

printf '\n'
fail 'the app did not become healthy. Check `docker compose logs app`.'
