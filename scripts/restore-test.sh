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

# The checks that actually matter to the household: that the financial data itself came back,
# not merely that the schema did. A dump whose `account` table restored empty would pass every
# check above and still be a failed backup.
#
# Conditional on the table existing, so this still passes against an older artefact taken before
# Phase 1's migration — a restore test that fails on a valid historical dump would train its user
# to ignore it.
if docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
    -c "select to_regclass('public.account');" | grep -q account; then
  ACCOUNTS="$(docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
    -c 'select count(*) from account;')"
  [ "${ACCOUNTS}" -gt 0 ] || fail 'restored database has no accounts — the dump is not usable'
  log "accounts restored: ${ACCOUNTS}"

  SNAPSHOTS="$(docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
    -c 'select count(*) from balance_snapshot;')"
  [ "${SNAPSHOTS}" -gt 0 ] || fail 'restored database has no balance snapshots — net worth history is missing'
  log "balance snapshots restored: ${SNAPSHOTS}"

  PEOPLE="$(docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" \
    -c 'select count(*) from person;')"
  [ "${PEOPLE}" -gt 0 ] || fail 'restored database has no people'
  log "people restored: ${PEOPLE}"

  # Net worth from the restored dump: the latest snapshot per live account, summed. Printed for
  # comparison rather than asserted against a fixed figure. The arithmetic is exact here (the
  # column is NUMERIC), so a mismatch against the running app means the dump is genuinely stale
  # rather than a rounding artefact.
  NET_WORTH="$(docker exec "${SCRATCH_CONTAINER}" psql -tAX -U postgres -d "${SCRATCH_DB}" -c "
    select coalesce(sum(latest.amount), 0)
      from account a
      join lateral (
        select amount from balance_snapshot s
         where s.account_id = a.id
         order by s.snapshot_date desc, s.captured_at desc
         limit 1
      ) latest on true
     where a.archived = false;")"
  log "net worth in the restored dump: ${NET_WORTH}"
  printf '  Compare that against the figure the app shows on its dashboard.\n'
fi

printf '\n\033[32m[restore-test] PASSED — %s restores cleanly into a scratch container\033[0m\n' "${ARTEFACT}"
printf 'Record the date in docs/RESTORE_TEST.md.\n'
