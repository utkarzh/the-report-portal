// Shared between UsersFilter.tsx (client) and admin/users/page.tsx (server).
// Plain values/types can't cross the server→client import boundary — a
// server component importing a const from a 'use client' file resolves to an
// opaque React Client Reference, not the value — so this lives in its own
// non-client module.
export type AccessKey =
  | 'interview'
  | 'transcriptions'
  | 'business_cases'
  | 'editorial_briefs'
  | 'meeting_preparation'
  | 'finance_field'

export const ACCESS_LABELS: Record<AccessKey, string> = {
  interview: 'Interview Tool',
  transcriptions: 'Transcriptions',
  business_cases: 'Business Cases',
  editorial_briefs: 'Editorial Briefs',
  meeting_preparation: 'Meeting Preparation',
  finance_field: 'Cash Box (Field)',
}

// Grouping for the dropdown UI and for query-building (editorial keys imply
// "or role = admin", the finance key deliberately does not — admins are
// finance_admin, not "field", see access.ts).
export const EDITORIAL_ACCESS_KEYS: AccessKey[] = [
  'interview',
  'transcriptions',
  'business_cases',
  'editorial_briefs',
  'meeting_preparation',
]
export const FINANCE_ACCESS_KEYS: AccessKey[] = ['finance_field']

const ALL_ACCESS_KEYS = new Set<string>([...EDITORIAL_ACCESS_KEYS, ...FINANCE_ACCESS_KEYS])

// The `access` query param is a comma-separated list of AccessKey, e.g.
// "interview,finance_field". Unknown/malformed entries are dropped rather
// than erroring — a stale bookmark or hand-edited URL should just filter to
// whatever survives.
export function parseAccessParam(raw: string | string[] | undefined): AccessKey[] {
  if (!raw || Array.isArray(raw)) return []
  const seen = new Set<AccessKey>()
  for (const part of raw.split(',')) {
    if (ALL_ACCESS_KEYS.has(part)) seen.add(part as AccessKey)
  }
  return Array.from(seen)
}

export function serializeAccessParam(keys: AccessKey[]): string {
  return keys.join(',')
}
