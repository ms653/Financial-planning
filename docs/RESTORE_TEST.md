# Quarterly Restore Test

PROPOSAL.md puts this in Phase 0's definition of done, not in a later "operational
polish" phase, for a specific reason: **a backup nobody has ever restored is a
hypothesis, not a backup.** The in-app staleness indicator proves `pg_dump` is *running*.
It cannot prove the artefact it produced is restorable — that the dump isn't truncated,
that `age` encrypted it with a key you still hold, that the restore actually reproduces
the data.

This test is the only thing that proves it.

---

## When

**Once per quarter**, and additionally after any of:

- a Postgres major-version bump (the most likely thing to silently break restore);
- a change to `scripts/backup.sh`;
- rotating the `age` key;
- changing the off-machine destination.

Put it in a calendar with a reminder. It takes about five minutes.

| Quarter | Date run | Artefact tested | Result | Notes |
|---|---|---|---|---|
| _(2026 Q3)_ | | | | first test due once real data exists |

Add a row every time. An empty table three years in is itself the finding.

---

## The automated test

```bash
./scripts/restore-test.sh                        # newest local encrypted dump
./scripts/restore-test.sh backups/some-dump.sql.age   # or a specific one
```

It never touches the live database. It:

1. picks an encrypted artefact and reports its age;
2. **decrypts it with your `age` identity file** — itself part of the test, since an
   encrypted backup whose key has been lost is indistinguishable from no backup at all;
3. starts a throwaway `postgres:16-alpine` container on `127.0.0.1:55432`;
4. restores the dump with `psql -v ON_ERROR_STOP=1`, so any error fails the test rather
   than being skipped past;
5. **asserts the restored contents** — table count greater than zero, and row counts for
   known tables. Restoring without error is necessary but not sufficient: an empty dump
   restores perfectly;
6. tears the container down, and shreds the decrypted plaintext, on every exit path.

It needs `BACKUP_AGE_IDENTITY` (default
`~/.config/financial-planning/backup-key.txt`) to point at your private key.

---

## Test the off-machine copy too — at least annually

`restore-test.sh` defaults to a *local* artefact. That does not exercise the part most
likely to be quietly broken: the copy that left the machine. Once a year, fetch a dump
back from the remote and test *that* file:

```bash
rclone copy remote:bucket/path/financial-planning-20260726T023000Z.sql.age /tmp/
./scripts/restore-test.sh /tmp/financial-planning-20260726T023000Z.sql.age
```

Do this from a *different* machine at least once, using only the private key from your
off-site store. That is the actual disaster scenario — laptop gone, key retrieved from
elsewhere — and it is the only version of this test that proves recovery is possible.

---

## The manual check the script can't do

From Phase 1 onward, after the script passes, spot-check that the numbers are *right*,
not just present:

```bash
docker run -d --name rt -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 postgres:16-alpine
age -d -i ~/.config/financial-planning/backup-key.txt -o /tmp/rt.sql backups/<artefact>.sql.age
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres < /tmp/rt.sql
psql -h 127.0.0.1 -p 55432 -U postgres -d postgres   # then query
docker rm -f rt && rm -f /tmp/rt.sql
```

Compare a household net worth total from the restored copy against what the live app
shows. A dump that restores cleanly but is missing yesterday's balance snapshots passes
the automated test and still fails the household. `scripts/restore-test.sh` carries a
`TODO(phase-1)` marker for adding these assertions once those tables exist.

---

## If the test fails

Treat it as a P1. Until it passes, assume there is **no** working backup.

| Symptom | Likely cause | Action |
|---|---|---|
| Decryption fails | Wrong/corrupt identity file, or artefact truncated in transit | Test an older artefact. If old ones decrypt and new ones don't, suspect `BACKUP_AGE_RECIPIENT`; if none do, suspect the key file |
| Decrypted dump is empty or tiny | `pg_dump` failed but the wrapper recorded success | Read `scripts/backup.sh`'s failure paths; run it manually and watch stderr |
| `psql` errors during restore | Postgres version skew between dump and scratch container | Match the scratch image to the version in `docker-compose.yml` |
| Restores but tables are missing | Migrations were never applied to the source database | Check `drizzle.__drizzle_migrations` in the live database |
| Restores but data is stale | Cron isn't running | Check the cron log, and check the in-app indicator — if it says healthy while the data is old, that's a second bug worth fixing immediately |

After any fix, re-run the test and record the outcome in the table above.
