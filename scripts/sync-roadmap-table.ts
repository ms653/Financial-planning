/**
 * Regenerates `docs/PROPOSAL.md`'s "Phased delivery" table from
 * `src/lib/roadmap/data.ts`'s `ROADMAP_ITEMS` — the single source of truth for phase
 * status/scope/dependencies, shared with the in-app `/roadmap` page. Run this after
 * any change to `ROADMAP_ITEMS`; never hand-edit the generated table directly (a
 * future edit there would just be overwritten the next time this runs, and would
 * mean the in-app page and the doc had silently diverged in the meantime).
 *
 *   npm run roadmap:sync
 *
 * Replaces only the region between the `<!-- ROADMAP_TABLE_START -->` /
 * `<!-- ROADMAP_TABLE_END -->` markers already in PROPOSAL.md — everything else in
 * the file (including the paragraph above the table explaining this generation
 * process) is left untouched.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROADMAP_ITEMS, type RoadmapItem } from '../src/lib/roadmap/data';

const PROPOSAL_PATH = join(__dirname, '..', 'docs', 'PROPOSAL.md');
const START_MARKER = '<!-- ROADMAP_TABLE_START -->';
const END_MARKER = '<!-- ROADMAP_TABLE_END -->';

const STATUS_LABELS: Record<RoadmapItem['status'], string> = {
  done: 'Done',
  'in-progress': 'In progress',
  queued: 'Queued',
};

function renderTable(items: readonly RoadmapItem[]): string {
  const rows = items.map((item) => `| ${item.phaseLabel} | ${STATUS_LABELS[item.status]} | ${item.detail} |`);
  return [START_MARKER, '| Phase | Status | Scope |', '|---|---|---|', ...rows, END_MARKER].join('\n');
}

function main(): void {
  const content = readFileSync(PROPOSAL_PATH, 'utf-8');
  const startIndex = content.indexOf(START_MARKER);
  const endIndex = content.indexOf(END_MARKER);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(
      `Couldn't find both markers (${START_MARKER} / ${END_MARKER}) in ${PROPOSAL_PATH} — has the surrounding section been rewritten?`,
    );
  }

  const before = content.slice(0, startIndex);
  const after = content.slice(endIndex + END_MARKER.length);
  const updated = `${before}${renderTable(ROADMAP_ITEMS)}${after}`;

  if (updated === content) {
    process.stdout.write('docs/PROPOSAL.md already matches ROADMAP_ITEMS — nothing to do.\n');
    return;
  }

  writeFileSync(PROPOSAL_PATH, updated);
  process.stdout.write('docs/PROPOSAL.md\'s Phased Delivery table regenerated from ROADMAP_ITEMS.\n');
}

main();
