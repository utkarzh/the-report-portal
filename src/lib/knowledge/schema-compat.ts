// Migration 034 (Knowledge Base) may not have been run yet on the database a
// deployment or local checkout points at. Without these helpers the new
// `can_access_knowledge_base` column breaks every query that names it — and
// the middleware's profile lookup reads that failure as "no profile", which
// signs every user out. With them, sign-in, user admin and every other module
// keep working, and the Knowledge Base says what's missing instead.
//
// Pure functions only: imported by the Edge middleware.

export const KB_FLAG_COLUMN = 'can_access_knowledge_base'

export const KB_NOT_INSTALLED_MESSAGE =
  'The Knowledge Base isn’t set up on this database yet — run supabase/migrations/034_knowledge_base.sql.'

interface PostgrestLikeError {
  code?: string
  message?: string
}

// PostgREST answers 42703 when a SELECT names a column that doesn't exist and
// PGRST204 when an INSERT/UPDATE payload does.
export function isMissingKbColumn(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false
  const mentionsColumn = (error.message ?? '').includes(KB_FLAG_COLUMN)
  return mentionsColumn && (error.code === '42703' || error.code === 'PGRST204' || /does not exist|could not find/i.test(error.message ?? ''))
}

// PGRST205 (current PostgREST) / 42P01 (older) = the table doesn't exist.
export function isMissingTable(error: PostgrestLikeError | null | undefined): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}

// The same row without the Knowledge Base flag, for retrying a write against a
// pre-034 database. The flag can't do anything until the migration runs.
export function withoutKbFlag<T extends Record<string, unknown>>(row: T): Omit<T, typeof KB_FLAG_COLUMN> {
  const copy: Record<string, unknown> = { ...row }
  delete copy[KB_FLAG_COLUMN]
  return copy as Omit<T, typeof KB_FLAG_COLUMN>
}
