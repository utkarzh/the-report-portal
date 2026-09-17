// Builds a PostgREST `.or()` filter string that case-insensitive substring-matches
// any of `columns`. `,` and `(`/`)` are stripped from the term because they're
// structural characters in PostgREST's filter mini-language and would otherwise
// let a search like "Acme, Inc" break the query instead of just matching literally.
export function orIlikeFilter(columns: string[], term: string): string {
  const safe = term.trim().replace(/[,()]/g, ' ').replace(/\s+/g, ' ')
  return columns.map((col) => `${col}.ilike.%${safe}%`).join(',')
}
