// Country-name matching for records keyed by free-text country fields (the
// advertiser database, the competitor-reports tracker) against what a user
// typed ("vietnam", "The Bahamas", "morroco", "east timor"). Pure helpers, no
// imports, safe on server and client.

// Canonical name → other spellings seen in TRC's records or typed by users.
const ALIASES: Record<string, string[]> = {
  vietnam: ['viet nam'],
  'timor leste': ['east timor'],
  'cote d ivoire': ['ivory coast'],
  'united arab emirates': ['uae'],
  'united kingdom': ['uk', 'great britain', 'britain'],
  'united states': ['usa', 'united states of america', 'us'],
  turkey: ['turkiye'],
  'czech republic': ['czechia'],
  'south korea': ['republic of korea', 'korea'],
  'democratic republic of the congo': ['drc', 'dr congo', 'congo kinshasa'],
  'republic of the congo': ['congo brazzaville'],
  myanmar: ['burma'],
  eswatini: ['swaziland'],
  'cape verde': ['cabo verde'],
  morocco: ['morroco', 'marocco'],
  netherlands: ['holland'],
  'north macedonia': ['macedonia'],
  kyrgyzstan: ['kyrgyz republic'],
  laos: ['lao pdr'],
  'saudi arabia': ['ksa'],
  'antigua and barbuda': ['antigua barbuda'],
  'trinidad and tobago': ['trinidad tobago', 'trinidad'],
  'bosnia and herzegovina': ['bosnia'],
}

export function normalizeCountry(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const CANONICAL = new Map<string, string>()
for (const [canonical, aliases] of Object.entries(ALIASES)) {
  CANONICAL.set(canonical, canonical)
  for (const a of aliases) CANONICAL.set(a, canonical)
}

// One key per country, so "Viet Nam", "Vietnam " and "vietnam" compare equal.
export function countryKey(s: string): string {
  const n = normalizeCountry(s)
  return CANONICAL.get(n) || n
}

export function sameCountry(a: string, b: string): boolean {
  const ka = countryKey(a)
  return Boolean(ka) && ka === countryKey(b)
}

// Every spelling worth searching free text for. Two-letter aliases (us, uk) are
// left out: as whole words they'd match far too much unrelated text.
export function countrySearchTerms(s: string): string[] {
  const key = countryKey(s)
  if (!key) return []
  const terms = new Set([key, normalizeCountry(s), ...(ALIASES[key] || [])])
  return [...terms].filter((t) => t.length >= 3)
}

// Words that, placed before or after a country's name, make it a different
// country ("Equatorial Guinea", "Papua New Guinea", "Guinea-Bissau", "South
// Sudan", "Northern Ireland", "North Korea") or a newspaper ("The Japan Times",
// "China Daily", "Korea JoongAng Daily"). In the competitor tracker 100 of the
// 421 rows mentioning Japan did so only through The Japan Times, i.e. reports
// on other countries. A row that also names the country on its own still
// matches.
const BEFORE = ['equatorial', 'new', 'south', 'north', 'northern', 'east', 'west', 'american', 'french', 'british']
const AFTER = ['bissau', 'times', 'daily', 'herald', 'post', 'today', 'tribune', 'news', 'journal', 'gazette', 'joongang']

// True when a line of free text (a spreadsheet row) mentions the country as a
// whole word, ignoring case and accents.
export function mentionsCountry(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false
  const words = ` ${normalizeCountry(text)} `
  return terms.some((term) => {
    let from = 0
    for (;;) {
      const at = words.indexOf(` ${term} `, from)
      if (at < 0) return false
      const before = words.slice(0, at).trim().split(' ').pop() || ''
      const after = words.slice(at + term.length + 2).split(' ')[0] || ''
      const partOfLongerName = (BEFORE.includes(before) && !term.startsWith(`${before} `)) || AFTER.includes(after)
      if (!partOfLongerName) return true
      from = at + 1
    }
  })
}
