#!/usr/bin/env bash
#
# Encrypted Postgres backup.
#
#   ./scripts/backup.sh
#
# PROPOSAL.md: "Backup is not optional, and an unwatched backup is not a backup." So this
# script does three things, not one:
#   1. pg_dump the database and encrypt the dump before it can leave the machine.
#   2. Optionally copy the encrypted artefact off-machine.
#   3. Record the outcome in the backup_run table, success or failure, so the app can
#      show a "last successful backup" indicator and go red when it goes stale.
#
# Step 3 is the part that makes this a watched backup. A failure is recorded too — a
# script that only writes rows when it succeeds leaves "never ran" and "failed" looking
# identical.
#
# Runs on the HOST (not inside the app container) so the artefact lands on the host
# filesystem where an off-machine copy can pick it up. It shells into the db container
# for pg_dump, so no postgres-client install is needed on the host.
#
# Schedule it with cron — see docs/DEPLOYMENT.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

# shellcheck disable=SC1091
[ -f .env ] && set -a && . ./.env && set +a

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-financial_planning}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${BACKUP_DIR}"

PLAIN_DUMP="${BACKUP_DIR}/financial-planning-${STAMP}.sql"
ENCRYPTED_DUMP="${PLAIN_DUMP}.age"

log() { printf '[backup] %s\n' "$1" >&2; }

compose() { docker compose "$@"; }

# Escape single quotes for embedding in SQL literals.
sql_quote() { printf "%s" "${1//\'/\'\'}"; }

# Record the outcome. Uses psql inside the db container, so this works even when the
# app container is down — which is exactly when you most want the failure recorded.
record_run() {
  local outcome="$1" detail="$2" path="${3:-}" bytes="${4:-}" sha="${5:-}" method="${6:-}"

  local path_sql='NULL' bytes_sql='NULL' sha_sql='NULL' method_sql='NULL'
  [ -n "${path}" ] && path_sql="'$(sql_quote "${path}")'"
  [ -n "${bytes}" ] && bytes_sql="${bytes}"
  [ -n "${sha}" ] && sha_sql="'$(sql_quote "${sha}")'"
  [ -n "${method}" ] && method_sql="'$(sql_quote "${method}")'"

  local statement
  statement="INSERT INTO backup_run
      (started_at, finished_at, outcome, artefact_path, artefact_bytes, artefact_sha256, encryption_method, detail)
    VALUES
      ('${STARTED_AT}', now(), '${outcome}', ${path_sql}, ${bytes_sql}, ${sha_sql}, ${method_sql}, '$(sql_quote "${detail}")');"

  if compose exec -T db psql -v ON_ERROR_STOP=1 -q -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
      -c "${statement}" >/dev/null 2>&1; then
    log "recorded ${outcome} in backup_run"
  else
    # Don't let a bookkeeping failure mask a successful dump. Loud, but non-fatal.
    log "WARNING: could not record this run in backup_run (is the db container up, and have migrations been applied?)"
  fi
}

on_failure() {
  local message="$1"
  log "FAILED: ${message}"
  rm -f "${PLAIN_DUMP}"
  record_run failure "${message}"
  exit 1
}

# --- 1. Dump ------------------------------------------------------------------------
log "dumping ${POSTGRES_DB}"
if ! compose exec -T db pg_dump \
      --username "${POSTGRES_USER}" \
      --dbname "${POSTGRES_DB}" \
      --format=plain \
      --no-owner \
      --no-privileges \
      > "${PLAIN_DUMP}" 2>/dev/null; then
  on_failure "pg_dump failed"
fi

if [ ! -s "${PLAIN_DUMP}" ]; then
  on_failure "pg_dump produced an empty file"
fi

# --- 2. Encrypt ---------------------------------------------------------------------
# Encrypt before any off-machine copy. An unencrypted dump of a household's complete
# financial position sitting in cloud storage is the worst outcome this whole script
# exists to avoid, so a missing recipient key is a hard failure, not a warning.
if [ -z "${BACKUP_AGE_RECIPIENT}" ]; then
  on_failure "BACKUP_AGE_RECIPIENT is not set — refusing to leave an unencrypted dump on disk"
fi

if ! command -v age >/dev/null 2>&1; then
  on_failure "the 'age' binary is not installed (see docs/DEPLOYMENT.md)"
fi

log "encrypting to ${ENCRYPTED_DUMP}"
if ! age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" --output "${ENCRYPTED_DUMP}" "${PLAIN_DUMP}"; then
  on_failure "age encryption failed"
fi

# The plaintext dump has served its purpose and must not linger.
rm -f "${PLAIN_DUMP}"

BYTES="$(wc -c < "${ENCRYPTED_DUMP}" | tr -d ' ')"
SHA="$(sha256sum "${ENCRYPTED_DUMP}" | cut -d' ' -f1)"
log "encrypted artefact: ${BYTES} bytes, sha256 ${SHA}"

# --- 3. Off-machine copy ------------------------------------------------------------
# Deliberately a single rsync/rclone hook rather than a built-in cloud integration:
# PROPOSAL.md leaves the destination for the household to configure, and an
# over-engineered uploader here would be a second thing to keep working.
if [ -n "${BACKUP_REMOTE}" ]; then
  log "copying to ${BACKUP_REMOTE}"
  if command -v rclone >/dev/null 2>&1 && [[ "${BACKUP_REMOTE}" == *:* && "${BACKUP_REMOTE}" != /* ]]; then
    rclone copy "${ENCRYPTED_DUMP}" "${BACKUP_REMOTE}" || on_failure "off-machine copy via rclone failed"
  else
    rsync -a "${ENCRYPTED_DUMP}" "${BACKUP_REMOTE}" || on_failure "off-machine copy via rsync failed"
  fi
else
  # TODO(household): set BACKUP_REMOTE in .env. Until then the encrypted dump only
  # exists on this laptop, which means a single disk failure still loses everything.
  log "WARNING: BACKUP_REMOTE is not set — this backup exists only on this machine"
fi

# --- 4. Retention -------------------------------------------------------------------
# Keep the most recent 30 local artefacts. Off-machine retention is the remote's job.
log "pruning local artefacts beyond the most recent 30"
ls -1t "${BACKUP_DIR}"/financial-planning-*.sql.age 2>/dev/null | tail -n +31 | while read -r old; do
  log "removing ${old}"
  rm -f "${old}"
done

DETAIL="pg_dump + age"
[ -n "${BACKUP_REMOTE}" ] && DETAIL="${DETAIL} + off-machine copy"
[ -z "${BACKUP_REMOTE}" ] && DETAIL="${DETAIL} (local only — BACKUP_REMOTE unset)"

record_run success "${DETAIL}" "${ENCRYPTED_DUMP}" "${BYTES}" "${SHA}" "age"
log "done"
