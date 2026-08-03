import { describe, expect, it } from 'vitest';
import { resolveRoadmapOrder } from './queries';
import type { RoadmapItem } from './data';

const ITEMS: RoadmapItem[] = [
  { id: 'a', phaseLabel: '1', title: 'A', summary: '', detail: '', status: 'done' },
  { id: 'b', phaseLabel: '2', title: 'B', summary: '', detail: '', status: 'queued' },
  { id: 'c', phaseLabel: '3', title: 'C', summary: '', detail: '', status: 'queued' },
];

describe('resolveRoadmapOrder', () => {
  it('returns the default order when nothing has been saved', () => {
    expect(resolveRoadmapOrder(null, ITEMS).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns the default order for an empty saved array too', () => {
    expect(resolveRoadmapOrder([], ITEMS).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('respects a saved custom order', () => {
    expect(resolveRoadmapOrder(['c', 'a', 'b'], ITEMS).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('appends an item missing from the saved order, in default order, at the end', () => {
    // 'c' is new since the household last reordered — only 'a' and 'b' were saved.
    expect(resolveRoadmapOrder(['b', 'a'], ITEMS).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('silently drops a saved id that no longer exists in ROADMAP_ITEMS', () => {
    expect(resolveRoadmapOrder(['x', 'c', 'a'], ITEMS).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('de-duplicates a saved id that appears twice, without dropping any real item', () => {
    expect(resolveRoadmapOrder(['a', 'a', 'b'], ITEMS).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
