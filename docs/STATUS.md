# Project Status

Last updated: 2026-07-26

## Done
- **`docs/PROPOSAL.md`** — full research brief, features proposal, and implementation plan. Nine rounds of review (see Sections 6–13 for the changelog), including eight independent architecture-review passes covering UK tax/pension mechanics, mobile/offline architecture, and a full technical build-readiness review of Section 5.
- **`docs/DESIGN_SPEC.md`** — P1 interaction design spec (user flows, screen specs, states, components, copy, accessibility).
- **`docs/design-mockup.html`** — visual design direction ("ledger & brass" palette), demonstrates the stale/computing/offline state machine live.

All three are final and pushed to `main`. Together they're a complete, self-contained spec — a fresh session can pick up implementation from `docs/PROPOSAL.md` Section 5 alone without needing prior conversation history.

## In progress
**Phase 0 implementation** (repo scaffold, Drizzle/Postgres/Docker, GitHub Actions CI, passphrase auth per the Security notes spec, Tailscale Serve HTTPS, backup tooling with an in-app staleness indicator — exact scope is PROPOSAL.md's Phase 0 row in the Phased Delivery table).

- Delegated to an Opus-model agent running in an isolated git worktree (so the diff can be reviewed before merging to `main` — this phase includes auth/security code).
- **Two attempts both failed early with `529 Overloaded`** (a transient Anthropic-side capacity issue, not a task problem) — neither made any commits, so there's no partial/stray worktree to clean up.
- A retry is scheduled (self-bound reminder trigger on the originating session). If picking this up fresh: just relaunch the same Phase 0 build via an Opus agent, `isolation: worktree`, told not to push to `origin` — the full spec it needs is in `docs/PROPOSAL.md` Section 5 (tech stack, data model, compute execution model, provider abstraction, security spec) and `docs/DESIGN_SPEC.md`/`docs/design-mockup.html` for the passphrase-gate screen's look.
- **Do not build Phase 1+** (household/account model, net worth dashboard, portfolio view, retirement engine) as part of this — Phase 0 is scaffold/auth/CI/backup only, ending in a minimal placeholder authenticated page.

## Next steps
1. Get Phase 0 implemented and merged to `main` (review the worktree diff first, particularly the auth code).
2. Phase 1 per the Phased Delivery table: household/people/accounts data model, manual net worth dashboard.
3. Continue in phase order through Phase 8 as specified in `docs/PROPOSAL.md`.
