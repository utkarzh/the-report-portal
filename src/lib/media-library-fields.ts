// Request-body → media_library columns, shared by the create and update
// routes. Only the keys present in the body are returned, so an update
// touches nothing it wasn't sent. Text is trimmed at the ends only: the
// letter description is copied into letters word for word.
const FIELDS: [bodyKey: string, column: string][] = [
  ['name', 'name'],
  ['country', 'country'],
  ['positioningStatement', 'positioning_statement'],
  ['audienceReach', 'audience_reach'],
  ['editorialNarrativeFocus', 'editorial_narrative_focus'],
  ['letterDescription', 'letter_description'],
  ['writingRules', 'writing_rules'],
]

export function mediaFieldsFromBody(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, column] of FIELDS) {
    if (typeof body[key] === 'string') out[column] = (body[key] as string).trim()
  }
  if ('name' in out) out.name = out.name.replace(/\s+/g, ' ')
  return out
}
