# Financial Planning

A private, self-hosted financial planning and investment analysis app for one UK
household. Net worth tracking, portfolio analysis, UK-calibrated retirement Monte Carlo
modelling, and a cash allocation advisor — all running on your own hardware, reachable
only over Tailscale, with nothing leaving the machine except market-data lookups.

**Current state: Phase 0 complete.** Scaffold, database, CI, auth, HTTPS, and backup
tooling are in place. There is no application functionality yet beyond the passphrase
gate and a placeholder authenticated page.

## Documentation

| Document | What it is |
|---|---|
| [`docs/PROPOSAL.md`](docs/PROPOSAL.md) | Research brief, features proposal, and implementation plan. Section 5 is the technical spec; Sections 6–13 are the review changelog. Nine review rounds |
| [`docs/DESIGN_SPEC.md`](docs/DESIGN_SPEC.md) | P1 interaction spec — flows, screens, states, copy, accessibility |
| [`docs/design-mockup.html`](docs/design-mockup.html) | Visual direction ("ledger & brass"). Open in a browser |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | **Start here to run it.** Setup, Tailscale HTTPS, deploys, backups |
| [`docs/RESTORE_TEST.md`](docs/RESTORE_TEST.md) | The quarterly restore test, and what to do when it fails |
| [`docs/STATUS.md`](docs/STATUS.md) | Where the project is and what's next |

## Quick start

Full instructions, including the Tailscale step, are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The short version:

```bash
cp .env.example .env

npm install                      # once, on the host
npm run passphrase:hash          # generates APP_PASSPHRASE_HASH for .env
openssl rand -base64 48          # SESSION_SECRET
openssl rand -base64 24          # POSTGRES_PASSWORD

docker compose up -d db          # database first
docker compose run --rm migrate  # create the schema
docker compose up -d             # then the app

curl -s http://127.0.0.1:3000/api/health
```

Then <http://127.0.0.1:3000>, which redirects to the passphrase gate.

> Serving over plain HTTP locally? Set `COOKIE_SECURE=false` in `.env` — otherwise the
> browser discards the `Secure` session cookie and login appears to fail. Setting up
> Tailscale Serve (DEPLOYMENT.md §2) is the better answer.

## Development

```bash
npm run dev         # Next.js dev server on :3000
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
npm run test:watch
npm run lint
npm run db:generate # generate a migration after editing src/lib/db/schema.ts
npm run db:migrate  # apply pending migrations
```

`npm run dev` needs a reachable Postgres. Either run `docker compose up -d db` and point
`DATABASE_URL` at `localhost:5432`, or use your own local instance.

## Operations

```bash
./deploy.sh                 # pull -> build -> dump -> migrate -> up (order matters)
./scripts/backup.sh         # encrypted pg_dump; records status for the in-app indicator
./scripts/restore-test.sh   # quarterly: prove a backup actually restores
```

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Postgres 16 · Drizzle ORM ·
Docker Compose · Vitest · argon2id + signed session cookies · Tailscale Serve for HTTPS

Every one of these was chosen in `docs/PROPOSAL.md` Section 5 after explicit
architecture review — including Next 14 over a newer major (deliberate reuse of the
sibling Warhammer-app's patterns) and Drizzle over Prisma (plain reviewable SQL
migrations against irreplaceable data). Please read the reasoning there before
substituting any of them.

## Security model

Tailscale is the network boundary; the passphrase is a device-loss and houseguest gate.
No public port is opened, and no port is published beyond `127.0.0.1`. One shared
household passphrase — no per-user accounts, no signup — hashed with argon2id and held
as a hash in an environment variable, never committed. Sessions are signed, HTTP-only,
`SameSite=Lax` cookies with a 30-day rolling lifetime. No third-party analytics or
telemetry anywhere.

Full spec and rationale: `docs/PROPOSAL.md` → Security notes.

## Roadmap

Phase 0 ✅ scaffold, auth, CI, backup · Phase 1 household/accounts + net worth dashboard ·
Phase 2 portfolio + market data · Phase 3 retirement Monte Carlo · Phase 4 stock analysis
workbench · Phase 4.5 cash allocation advisor · Phase 4.6 scenario planning ·
Phase 4.7 reporting · Phase 5 UK Open Banking spike · Phase 6 PWA + offline ·
Phase 7 visual design pass

Full table with scope per phase: `docs/PROPOSAL.md` → Phased delivery.

## Licence

MIT — see [LICENSE](LICENSE).
