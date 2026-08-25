// A project's "week 1" is the 7 days starting on its own creation date, not
// a calendar Monday-Sunday week. A project created on a Friday has week
// boundaries every Friday — week 2 starts exactly 7 days after week 1, and
// so on. This intentionally ignores ISO week numbers entirely.

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// Start/end (inclusive, ISO yyyy-mm-dd) of the given 1-indexed week number,
// relative to the project's creation date.
export function projectWeekBounds(projectCreatedAt: string, weekNumber: number): { start: string; end: string } {
  const start = toUtcMidnight(new Date(projectCreatedAt))
  start.setUTCDate(start.getUTCDate() + (weekNumber - 1) * 7)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

// Which week number a given date falls into, relative to the project's
// creation date. Used to find "the current week" and to know how many weeks
// have elapsed (for the export dropdown's range).
export function projectWeekNumberForDate(projectCreatedAt: string, date: Date): number {
  const start = toUtcMidnight(new Date(projectCreatedAt))
  const target = toUtcMidnight(date)
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000)
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}
