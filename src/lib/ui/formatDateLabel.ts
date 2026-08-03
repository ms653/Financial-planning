/** "26 Jul 2026" — a short, human-readable date label. Used for chart hover tooltips;
 * every other date in this codebase is displayed as a plain ISO string, so this is
 * deliberately its own small helper rather than a change to any existing formatter. */
export function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
