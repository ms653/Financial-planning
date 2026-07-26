# Deployment & Operations

How to stand this up, expose it over Tailscale (so it's reachable from a phone as well
as the laptop it runs on), back it up, and deploy changes to it. Written as a Phase 0
runbook; it still applies unchanged now that Phase 1 (household/accounts/net worth
dashboard) is built on top — nothing about how the app is deployed or reached changed,
only what's behind the login gate. See `docs/STATUS.md` for what that is.

Everything here assumes the app runs on **your own laptop** (or, later, an always-on
mini-PC — see PROPOSAL.md's Mobile/tablet access section for that upgrade path). A
phone or tablet never runs the app itself — it just reaches the laptop's instance over
Tailscale, per §2 below.

---

## 0. Prerequisites

| Requirement | Why |
|---|---|
| Docker + the `docker compose` plugin | The whole stack runs in two containers |
| **Full-disk encryption on the host** | PROPOSAL.md states this as a prerequisite, not a suggestion: the Postgres volume holds the household's complete financial position in plaintext at rest |
| `age` (`apt install age` / `brew install age`) | Encrypts backup dumps before they leave the machine |
| Tailscale, logged in on this machine and on every phone/tablet that needs access | The network boundary. No public port is ever opened |
| Node 22 + `npm install`, **on the host** | Only needed to run `npm run passphrase:hash` once and to work on the code. Deploys and migrations run inside containers |

---

## 1. First-time setup

### 1.1 Configure the environment

```bash
cp .env.example .env
```

Then fill in the four values that have no safe default:

**`POSTGRES_PASSWORD`** — any long random string. It is only reachable on the Docker
network and on loopback.

```bash
openssl rand -base64 24
```

**`SESSION_SECRET`** — the HMAC key for session cookies. At least 32 characters.
Rotating it later logs every device out, which is the intended "log everyone out" lever.

```bash
openssl rand -base64 48
```

**`APP_PASSPHRASE_HASH`** — the argon2id hash of the household passphrase. Generate it
interactively; the script reads from stdin with echo suppressed, so the passphrase never
lands in shell history or the process list:

```bash
npm run passphrase:hash
```

Paste the printed `APP_PASSPHRASE_HASH='...'` line into `.env`. **Keep the single
quotes** — the hash contains `$` characters that a shell would otherwise expand.

Pick a memorable multi-word phrase over a short complex one. Both people have to type it
on a phone keyboard, and the threat model is device loss and houseguests, not a
determined remote attacker — Tailscale already handles that part.

> The plaintext passphrase is never stored anywhere. If everyone forgets it, re-run
> `npm run passphrase:hash` with a new one and redeploy — no data is lost.

**`BACKUP_AGE_RECIPIENT`** — see section 4.

### 1.2 Bring the stack up

```bash
docker compose up -d db          # database first
docker compose run --rm migrate  # create the schema
docker compose up -d             # then the app
```

Check it:

```bash
curl -s http://127.0.0.1:3000/api/health
# {"status":"ok","database":"up"}
```

Open <http://127.0.0.1:3000>. You should be redirected to `/login`.

> **Local HTTP caveat:** `NODE_ENV=production` defaults `COOKIE_SECURE` to on, and a
> browser silently discards a `Secure` cookie sent over plain HTTP — so login will appear
> to succeed and then bounce you straight back to `/login`. Either finish the Tailscale
> setup below (recommended, and the whole reason HTTPS was pulled into Phase 0) or set
> `COOKIE_SECURE=false` in `.env` temporarily.

---

## 2. Tailscale Serve (HTTPS)

Pulled forward from Phase 6 into Phase 0 deliberately: session cookies need `Secure`
from day one, and the PWA prerequisites in Phase 6 (service workers,
`navigator.storage.persist()`) require a secure context regardless.

### 2.1 Enable HTTPS on your tailnet

Once per tailnet, in the [Tailscale admin console](https://login.tailscale.com/admin/dns):
enable **HTTPS Certificates**. Note your tailnet name (e.g. `tailnet-name.ts.net`) and
this machine's name (e.g. `laptop`), which together give the hostname you'll use:
`laptop.tailnet-name.ts.net`.

### 2.2 Point Tailscale at the app

```bash
sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

`--bg` persists the configuration across reboots. Tailscale fetches and renews the TLS
certificate itself; there is nothing to configure in the app or in Docker.

Do **not** use `tailscale funnel` — that exposes the app to the public internet, which
this app's entire security model assumes never happens.

### 2.3 Tell the app its public hostname — required

This step is not optional and its absence has a confusing failure mode. Set in `.env`:

```
SERVER_ACTIONS_ALLOWED_ORIGINS=laptop.tailnet-name.ts.net
```

Then `docker compose up -d` to pick it up.

Why: `tailscale serve` terminates TLS and reverse-proxies to `127.0.0.1:3000`, so the
browser's `Origin` header says `https://laptop.tailnet-name.ts.net` while the app's own
`Host` header says `localhost:3000`. Next.js 14 compares those two when validating
Server Action POSTs and rejects the mismatch. Without this variable, **the login form
fails with an opaque error while every other page loads fine** — a symptom that looks
like an auth bug and isn't.

Add more hostnames comma-separated if you reach the app by more than one name.

### 2.4 Verify from a phone

With Tailscale connected on the phone, open `https://laptop.tailnet-name.ts.net`. You
should get the passphrase gate over HTTPS, and logging in should stick.

### What the app does *not* assume about Tailscale

Deliberately, so nothing here breaks when the proxy is in front of it:

- No hardcoded hostname or base URL anywhere; all links and fetches are relative.
- `Secure` on the session cookie comes from `COOKIE_SECURE`, not from the request's
  protocol — see the comment in `src/lib/env.ts` for why sniffing gets this backwards.
- The Origin check in `src/lib/auth/csrf.ts` consults `X-Forwarded-Host`, which is safe
  because only the loopback proxy can set it here.
- Containers publish on `127.0.0.1` only, so Tailscale (or an SSH tunnel) is the sole
  route in even before authentication.

---

## 3. Deploying a change

```bash
./deploy.sh
```

The order is fixed and load-bearing:

```
preflight -> git pull -> docker compose build -> pg_dump -> migrate -> up -d -> health check
```

- **Build before dump** so a broken build fails without having touched the database.
- **Dump before migrate.** Drizzle migrations here are forward-only; this dump *is* the
  rollback mechanism. Reordering these two leaves a data-destroying migration with no
  recovery path. Do not "tidy" it.
- Preflight refuses to run at all if `APP_PASSPHRASE_HASH` isn't an argon2id hash or
  `SESSION_SECRET` is under 32 characters — catching a bad deploy before it becomes an
  app nobody can log into.

Pre-migration dumps go to `backups/pre-migration/`. They are **unencrypted and local** —
a rollback artefact for the next few minutes, not a backup.

### If a migration fails

`deploy.sh` aborts and prints the dump path. To roll back:

```bash
docker compose down app
docker compose exec -T db psql -U postgres -d financial_planning \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker compose exec -T db psql -U postgres -d financial_planning < backups/pre-migration/pre-migration-<stamp>.sql
git checkout <previous-commit>
docker compose up -d
```

---

## 4. Backups

> "Backup is not optional, and an unwatched backup is not a backup." — PROPOSAL.md
>
> "A `pg_dump` that's been silently failing for six months is the single most likely
> catastrophic failure mode for this system."

### 4.1 Generate an encryption key

```bash
mkdir -p ~/.config/financial-planning
age-keygen -o ~/.config/financial-planning/backup-key.txt
chmod 600 ~/.config/financial-planning/backup-key.txt
```

Put the printed **public key** (`age1...`) in `.env` as `BACKUP_AGE_RECIPIENT`.

**Store the private key somewhere off this machine** — a password manager, or printed and
filed. An encrypted backup whose key only exists on the failed disk is not a backup. This
is the single most common way home backup schemes turn out to be worthless.

### 4.2 Configure the off-machine destination

Set `BACKUP_REMOTE` in `.env` to an `rsync` target (`user@host:/path`) or an `rclone`
remote (`remote:bucket/path`). Because the dump is already encrypted with `age`, an
untrusted destination — any consumer cloud storage — is fine.

Left unset, the script still runs and still encrypts, but warns that the backup exists
only on this laptop. A single disk failure then loses everything, so treat this as a TODO
to close, not an optional extra.

### 4.3 Run it

```bash
./scripts/backup.sh
```

It dumps via the `db` container, encrypts with `age`, deletes the plaintext, copies
off-machine if configured, prunes to the 30 most recent local artefacts, and — the part
that makes it a *watched* backup — records the outcome in the `backup_run` table.
Failures are recorded too, so "never ran" and "failed" don't look identical.

If `BACKUP_AGE_RECIPIENT` is unset, the script **fails** rather than leaving an
unencrypted dump on disk.

### 4.4 Schedule it

Daily at 02:30, via `crontab -e` (use your real repo path):

```cron
30 2 * * * cd /path/to/financial-planning && ./scripts/backup.sh >> /tmp/financial-planning-backup.log 2>&1
```

On macOS, grant `cron` (or the wrapping shell) Full Disk Access, or use a launchd agent
instead — otherwise it fails silently on file access.

Deliberately cron rather than a scheduler service in the app: PROPOSAL.md says don't
over-engineer this, and an in-app scheduler dies whenever the app does.

### 4.5 Watch it

The authenticated page shows a **last successful backup** indicator, reading from
`backup_run`:

| State | Meaning |
|---|---|
| **Backup healthy** | A success inside the last 48h (`BACKUP_STALE_AFTER_HOURS`) |
| **Backup stale** | Last success older than that — warning styling |
| **No backup yet** | No success ever recorded |
| **Backup status unknown** | Status couldn't be read. Deliberately *not* shown as healthy, so an unreachable database can't masquerade as a working backup |

A recent *failed* attempt is called out separately, with its error, even when an older
success is still inside the window.

### 4.6 Test the restore

Quarterly, per Phase 0's definition of done. See **[RESTORE_TEST.md](./RESTORE_TEST.md)**.

```bash
./scripts/restore-test.sh
```

---

## 5. Operational notes

**Never run `docker compose down -v`.** The `-v` destroys the `pgdata` volume, which is
the household's only live copy of its financial data. `docker compose down` alone is safe.

**Logs:** `docker compose logs -f app`. Auth failures log a category (wrong passphrase,
misconfigured hash) and never the submitted value.

**Rotating the passphrase:** `npm run passphrase:hash`, update `.env`, `docker compose up -d`.
Existing sessions survive — the hash isn't part of the session signature. To force
everyone to re-enter it, rotate `SESSION_SECRET` at the same time.

**Lost or stolen device — what to do.** Session tokens are stateless: there is no
server-side session list, so logging out only clears the cookie on the device you're
using, and a token copied off a lost device stays valid for up to 30 days (rolling —
active use pushes that window out further, not in). The only kill switch is rotating
`SESSION_SECRET` (`openssl rand -base64 48`, update `.env`, `docker compose up -d`) —
this immediately invalidates every existing session on every device, including your
own, so everyone re-enters the passphrase on next load. Do this the moment a device
with the app installed/bookmarked is lost or compromised; don't wait for a scheduled
passphrase rotation.

**Restarting clears brute-force lockouts.** The counter is in-memory by design
(PROPOSAL.md). Acceptable here: only enrolled Tailscale devices can reach the port, and
anyone who can restart the container has already won.

**No telemetry.** Next.js telemetry is disabled in the Dockerfile; there is no analytics
of any kind, per the proposal's Security notes.

---

## 6. What this deployment does *not* include yet

Guarding against a reasonable misreading of this document — this is about
functionality, not deployment mechanics, which are unchanged since Phase 0:

- Household, people, accounts, balances, and the net worth dashboard **are** built
  (Phase 1) — logging in for the first time lands you in Guided Setup, not an empty
  page.
- No portfolio tracking, retirement engine, or market data yet — Phases 2–3.
- No PWA manifest, service worker, or offline layer — Phase 6. The app is usable from a
  phone browser over Tailscale today (§2), but nothing is cached and nothing works
  offline — no Tailscale connection on the phone means no access, full stop.
- No per-user accounts, no signup, no password reset. One shared household passphrase is
  the design, not a placeholder.
