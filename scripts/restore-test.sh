#!/usr/bin/env bash
#
# Quarterly restore test.
#
#   ./scripts/restore-test.sh                        # newest local encrypted dump
#   ./scripts/restore-test.sh backups/some-dump.sql.age
#
# PROPOSAL.md puts a quarterly restore test in Phase 0's definition of done: a backup
# nobody has ever restored is a hypothesis, not a backup. This script tests it the only
# way that counts — decrypt the artefact, restore it into a throwaway Postgres container,
# and query the result. It never touches the live database.
#
# Full procedure and what to do when it fails: docs/RESTORE_TEST.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

BACKUP_DIR="${BACKUP_DIR:-./backups}"
SCRATCH_CONTAINER='financial-planning-restore-test'
SCRATCH_PORT="${RESTORE_TEST_PORT:-55432}"
SCRATCH_DB='restore_test'
AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-${HOME}/.config/financial-planning/backup-key.txt}"

log() { printf '[restore-test] %s\n' "$1"; }
fail() { printf '\033[31m[restore-test] FAILED: %s\033[0m\n' "$1" >&2; cleanup; exit 1; }

cleanup() {
  docker rm -f "${SCRATCH_CONTAINER}" >/dev/null 2>&1 || true
  [ -n "${DECRYPTED:-}" ] && rm -f "${DECRYPTED}"
}
trap cleanup EXIT

# --- Pick an artefact ---------------------------------------------------------------
ARTEFACT="${1:-}"
if [ -z "${ARTEFACT}" ]; then
  ARTEFACT="$(ls -1t "${BACKUP_DIR}"/financial-planning-*.sql.age 2>/dev/null | head -1 || true)"
fi
[ -n "${ARTEFACT}" ] || fail "no encrypted dump found in ${BACKUP_DIR}. Run scripts/backup.sh first."
[ -f "${ARTEFACT}" ] || fail "${ARTEFACT} does not exist"

log "testing ${ARTEFACT}"
log "age: $(( ( $(date +%s) - $(stat -c %Y "${ARTEFACT}" 2>/dev/null || stat -f %m "${ARTEFACT}") ) / 3600 )) hours old"

# --- Decrypt ------------------------------------------------------------------------
# Decrypting with the identity file is itself part of the test: an encrypted backup whose
# key has been lost is indistinguishable from no backup at all.
[ -f "${AGE_IDENTITY}" ] || fail "age identity file not found at ${AGE_IDENTITY} (set BACKUP_AGE_IDENTITY)"
command -v age >/dev/null 2>&1 || fail "the 'age' binary is not installed"

DECRYPTED="$(mktemp /tmp/restore-test-XXXXXX.sql)"
log 'decrypting'
age --decrypt --identity "${AGE_IDENTITY}" --output "${DECRYPTED}" "${ARTEFACT}" \
  || fail 'decryption failed — the artefact is corrupt or the key does not match'
[ -s "${DECRYPTED}" ] || fail 'decrypted dump is empty'

# --- Restore into a scratch container ------------------------------------------------
log "starting scratch Postgres on 127.0.0.1:${SCRATCH_PORT}"
docker rm -f "${SCRATCH_CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${SCRATCH_CONTAINER}" \
  -e POSTGRES_PASSWORD=restore-test \
  -e POSTGRES_DB="${SCRATCH_DB}" \
  -p "127.0.0.1:${SCRATCH_PORT}:5432" \
  postgres:16-alpine >/dev/null || fail 'could not start the scratch container'

printf '[restore-test] waiting for scratch Postgres'
for _ in $(seq 1 30); do
  if docker exec "${SCRATCH_CONTAINER}" pg_isready -U postgres -d "${SCRATCH_DB}" >/dev/null 2>&1; then
    printf ' ready\n'; break
  fi
  printf '.'; sleep 1
done
docker exec "${SCRATCH_CONTAINER}" pg_isready -U postgres -d "${SCRATCH_DB}" >/dev/null 2>&1 \
  || fail 'scratch Postgres never became ready'

log 'restoring'
docker exec -i "${SCRATCH_CONTAINER}" psql -v ON_ERROR_STOP=1 -q -U postgres -d "${SCRATCH_DB}" \
  < "${DECRYPTED}" >/dev/null || fail 'psql restore reported an error'

# --- Verify -------------------------------------------------------------------------
# Restoring without error is necessary but not sufficient — an empty dump restores
# perfectly. Assert the schema and some rows actually arrived.
log 'verifying restored contents'

TABLES="$(docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
  -c "select count(*) from information_schema.tables where table_schema='public';")"
[ "${TABLES}" -gt 0 ] || fail 'restored database has no tables in the public schema'
log "tables restored: ${TABLES}"

if docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
    -c "select to_regclass('public.backup_run');" | grep -q backup_run; then
  ROWS="$(docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
    -c 'select count(*) from backup_run;')"
  log "backup_run rows restored: ${ROWS}"
fi

# From Phase 1 onward, add the checks that actually matter to the household here:
# a non-zero account count, and a net worth total that matches what the live app shows.
# TODO(phase-1): assert account/balance_snapshot row counts once those tables exist.

printf '\n\033[32m[restore-test] PASSED — %s restores cleanly into a scratch container\033[0m\n' "${ARTEFACT}"
printf 'Record the date in docs/RESTORE_TEST.md.\n'
