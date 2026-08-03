# Instructions for Claude Code sessions on this repo

## Check the roadmap before planning non-trivial work

`src/lib/roadmap/data.ts` (`ROADMAP_ITEMS`) is the single source of truth for phase
status, scope, and dependencies (`dependsOn`) — not `docs/PROPOSAL.md`'s "Phased
delivery" table, which is *generated* from it (see below), and not just what a session
happens to remember from earlier conversation.

Before starting a non-trivial implementation task:

1. Check `ROADMAP_ITEMS` (or the household's live reprioritization at `/roadmap`,
   which is the same data reordered) for where the requested work sits and what it
   depends on.
2. If the request conflicts with a stated dependency — e.g. asked to build something
   whose own `detail`/`dependsOn` says it needs a phase that isn't done yet, or the
   household's own drag-and-drop reordering has put it ahead of something it actually
   needs first — **say so and ask before proceeding**, rather than silently building
   out of order. The household explicitly asked for this check; it's not optional
   politeness.
3. This doesn't block the household from reordering `/roadmap` however they like —
   reordering is just a priority signal, not a promise it's buildable in that order.
   The check happens when a session is about to *act* on a request, not when they drag
   a card.

## `docs/PROPOSAL.md`'s Phased Delivery table is generated — don't hand-edit it

Edit `src/lib/roadmap/data.ts`'s `ROADMAP_ITEMS` instead, then run:

```
npm run roadmap:sync
```

This regenerates the table between the `<!-- ROADMAP_TABLE_START -->` /
`<!-- ROADMAP_TABLE_END -->` markers in `docs/PROPOSAL.md` from `ROADMAP_ITEMS`
directly (`scripts/sync-roadmap-table.ts`). A hand-edit to the generated rows will
just be silently overwritten next time the script runs, and in the meantime the
in-app `/roadmap` page (reading the same `ROADMAP_ITEMS`) and the doc would disagree
with each other — the exact drift this generation step exists to prevent.

If a roadmap change needs a new phase, a re-sequencing, or a status change: add/edit
the relevant `RoadmapItem` (including `dependsOn` if it's gained or lost a real
dependency), run the sync script, and commit both the data file and the regenerated
doc together.
