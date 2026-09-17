// Deterministic date formatting for anything rendered in a client component.
//
// `toLocaleDateString`/`toLocaleString` are unsafe there: Next.js pre-renders
// client components once on the server (Node's bundled ICU) and again during
// browser hydration (the browser's ICU), and the two can disagree on the
// abbreviated English month name for September specifically ("Sep" vs "Sept",
// a CLDR wording change different environments have picked up at different
// times) — React then throws a hydration mismatch. Reading local getters
// (`getDate()`/`getHours()`, etc.) has the same problem for a different
// reason: server and viewer can be in different timezones, so the day number
// itself can differ near a timezone boundary. These formatters sidestep both
// by using fixed month names and UTC getters, so server and client always
// compute the identical string.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toDate(date: Date | string): Date {
  return typeof date === 'string' ? new Date(date) : date
}

// "17 Sep"
export function formatDayMonth(date: Date | string): string {
  const d = toDate(date)
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

// "17 Sep 2026"
export function formatDayMonthYear(date: Date | string): string {
  const d = toDate(date)
  return `${formatDayMonth(d)} ${d.getUTCFullYear()}`
}

// "17 Sep 2026, 14:35" (UTC)
export function formatDayMonthYearTime(date: Date | string): string {
  const d = toDate(date)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${formatDayMonthYear(d)}, ${hh}:${mm}`
}
