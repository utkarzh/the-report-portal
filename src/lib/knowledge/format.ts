import { formatDayMonthYear } from '@/lib/date-format'

// Display helpers shared by the Knowledge Base pages (client-safe).

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

// "AM" for "Ana Martínez", "FO" for "Finance & Operations", "E" for "editorial@…".
export function initials(name: string | null | undefined): string {
  const s = (name || '').trim()
  if (!s) return '?'
  if (s.includes('@')) return s[0].toUpperCase()
  const words = s.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w))
  if (words.length === 0) return s[0].toUpperCase()
  return words
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

// "3 days ago". Server components only: it's relative to the moment of
// rendering, so in a client component the server render and the hydration
// pass could disagree.
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  }
  return formatDayMonthYear(iso)
}

// Chat-history bucket, relative to a `nowIso` the server passes down so the
// server render and hydration always agree. Days are UTC days.
export function chatGroupLabel(iso: string, nowIso: string): string {
  const day = (s: string) => Math.floor(new Date(s).getTime() / 86_400_000)
  const diff = day(nowIso) - day(iso)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'Previous 7 days'
  if (diff < 30) return 'Previous 30 days'
  return 'Older'
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// Rough reading size of extracted text ("≈ 4,200 words").
export function approxWords(chars: number | null | undefined): string | null {
  if (!chars) return null
  const words = Math.round(chars / 6 / 100) * 100
  return words >= 100 ? `≈ ${words.toLocaleString('en-US')} words` : null
}
