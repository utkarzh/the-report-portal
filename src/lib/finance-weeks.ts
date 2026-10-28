// Weeks always run Monday to Sunday (client request, Oct 2026: "regardless
// of when the first funds are sent or when the first file is uploaded …
// consistent across all projects"). Only the numbering is per project — the
// boundaries are the same calendar weeks everywhere.
//
// Week 1 is the Monday–Sunday week of the project's first entry — its oldest
// receipt or first funds, whichever is earlier (see projectWeekAnchor) — not
// of the day the project was created in the app: projects were running long
// before Cash Box existed, and their earlier receipts belong in real weeks.
// The creation date is only the fallback for a project with no entries yet.
// A date before week 1 (only a rejected ticket can be) gets a week number
// below 1; the ledgers group those under "Before week 1".

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// The Monday on or before the given date (UTC).
function mondayOf(d: Date): Date {
  const day = toUtcMidnight(d)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day
}

// The date week 1 is counted from: the earliest receipt (rejected tickets
// excluded — a rejected wrong date shouldn't set the calendar) or funds date,
// else the creation date. It moves earlier if an older receipt is logged
// later, and every week number moves with it — the price of counting from
// the project's real start rather than a fixed in-app date.
export function projectWeekAnchor(
  projectCreatedAt: string,
  expenses: { expense_date: string; status: string }[],
  fundings: { date_sent: string }[],
): string {
  let earliest: string | null = null
  for (const e of expenses) {
    if (e.status !== 'rejected' && e.expense_date && (!earliest || e.expense_date < earliest)) earliest = e.expense_date
  }
  for (const f of fundings) {
    if (f.date_sent && (!earliest || f.date_sent < earliest)) earliest = f.date_sent
  }
  return earliest ?? projectCreatedAt.slice(0, 10)
}

// Start (Monday) / end (Sunday), inclusive, ISO yyyy-mm-dd, of the given
// 1-indexed week number, counted from the project's week anchor.
export function projectWeekBounds(weekAnchor: string, weekNumber: number): { start: string; end: string } {
  const start = mondayOf(new Date(weekAnchor))
  start.setUTCDate(start.getUTCDate() + (weekNumber - 1) * 7)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

// Which week number a given date falls into. Below 1 for a date before
// week 1; at least 1 for "now" unless every entry is dated in the future.
// Used to find "the current week" and to know how many weeks have elapsed
// (for the export dropdown's range).
export function projectWeekNumberForDate(weekAnchor: string, date: Date): number {
  const start = mondayOf(new Date(weekAnchor))
  const target = toUtcMidnight(date)
  const diffDays = Math.floor((target.getTime() - start.getTime()) / 86400000)
  return Math.floor(diffDays / 7) + 1
}

// "Now" as a week number — never below 1, so a project whose only entries
// are dated ahead (an advance booking) still shows its week 1.
export function currentProjectWeek(weekAnchor: string): number {
  return Math.max(1, projectWeekNumberForDate(weekAnchor, new Date()))
}

// The ledgers' grouping of a row's yyyy-mm-dd date: its week number, or
// BEFORE_FIRST_WEEK for anything dated before week 1 — rather than folding
// those into week 1, whose printed dates they'd fall outside of.
export const BEFORE_FIRST_WEEK = -1

export function ledgerWeekOf(weekAnchor: string, isoDate: string): number {
  const n = projectWeekNumberForDate(weekAnchor, new Date(`${isoDate}T00:00:00Z`))
  return n >= 1 ? n : BEFORE_FIRST_WEEK
}
