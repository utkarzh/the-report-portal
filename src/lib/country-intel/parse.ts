import type { CiProfile, CiRawContacts } from './types'

// Local parsers for the plain-text formats the prompts ask for (see prompts.ts
// for why the replies are not JSON).

export function normName(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/\s+[—–-]\s+hint:.*$/, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(s\.?a\.?|sp\.? z o\.?o\.?|spolka akcyjna|s\.?p\.?a\.?|s\.?r\.?l\.?|gmbh|ag|ltd|limited|plc|inc|llc|corp(oration)?|group|grupa|holding|co)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const NONE = /^\s*(none|none found|not found|not published|n\/a|-|—|unknown|unverified)?\s*$/i
const nf = (v: string | undefined) => (v == null || NONE.test(v) ? '' : v.trim())
const pipe = (v: string) => v.split('|').map((x) => x.trim())

// Split a reply into "@@ COMPANY:" blocks and remember where each starts, so
// Google's grounding supports (text spans → result pages) can be mapped to the
// company they belong to.
function blocks(text: string): { name: string; body: string; start: number; end: number }[] {
  const re = /^\s*@@\s*COMPANY:\s*(.*)$/gm
  const marks: { name: string; start: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) marks.push({ name: m[1].replace(/\*+/g, '').trim(), start: m.index })
  return marks.map((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length
    return { name: mk.name, body: text.slice(mk.start, end), start: mk.start, end }
  })
}

function fields(body: string): [string, string][] {
  const out: [string, string][] = []
  for (const raw of body.split('\n').slice(1)) {
    const m = raw.replace(/^\s*[-*]\s*/, '').replace(/\*\*/g, '').match(/^([a-z_]+):\s*(.*)$/i)
    if (m) out.push([m[1].toLowerCase(), m[2].trim()])
  }
  return out
}

export function parseProfiles(text: string): (CiProfile & { _start: number; _end: number })[] {
  return blocks(text).map((b) => {
    const o: CiProfile & { _start: number; _end: number } = {
      input_name: b.name, name: '', website: '', subsector: '', headquarters: '', ownership: '', foreign_parent: '', hq_in_country: true,
      company_narrative: '', leader: { name: '', title: '', since: '', trajectory: '', public_statements: '', interview_hooks: '' },
      revenue: null, scale_indicators: [], international_operations: '', sector_ranking: '', recent_developments: [], government_connection: '',
      theme_relevance: '', cross_border_links: '', model_qualification: '', qualification_basis: '', priority: '', reason_for_inclusion: '',
      contacts: [], switchboard: null, sources: [], _start: b.start, _end: b.end,
    }
    const leaderKey: Record<string, keyof CiProfile['leader']> = { leader_name: 'name', leader_title: 'title', leader_since: 'since', leader_trajectory: 'trajectory', leader_statement: 'public_statements', leader_hooks: 'interview_hooks' }
    for (const [k, v] of fields(b.body)) {
      if (k === 'development') { const [date, t, u] = pipe(v); if (nf(t)) o.recent_developments.push({ date: nf(date), text: t, source_url: nf(u) }) }
      else if (k === 'contact') { const [name, role, phone, email, u] = pipe(v); if (nf(name) || nf(phone) || nf(email)) o.contacts.push({ name: nf(name), role: nf(role), phone: nf(phone), email: nf(email), source_url: nf(u) }) }
      else if (k === 'switchboard') { const [phone, email, address, u] = pipe(v); o.switchboard = { phone: nf(phone), email: nf(email), address: nf(address), source_url: nf(u) } }
      else if (k === 'source') { const [title, u, date] = pipe(v); if (nf(u)) o.sources.push({ title: title || '', url: u, date: date || '' }) }
      else if (k === 'revenue') { const [amount, currency, year, usd, status, u] = pipe(v); o.revenue = { amount: nf(amount), currency: currency || '', year: year || '', usd: nf(usd), status: /^verified/i.test(status || '') ? 'Verified' : 'Unverified', source_url: nf(u) } }
      else if (k === 'scale') o.scale_indicators = v.split(';').map((x) => x.trim()).filter((x) => x && !NONE.test(x))
      else if (leaderKey[k]) o.leader[leaderKey[k]] = nf(v)
      else {
        const map: Record<string, keyof CiProfile> = {
          name: 'name', website: 'website', subsector: 'subsector', headquarters: 'headquarters', ownership: 'ownership', foreign_parent: 'foreign_parent',
          narrative: 'company_narrative', international: 'international_operations', ranking: 'sector_ranking', government: 'government_connection',
          relevance: 'theme_relevance', cross_border: 'cross_border_links', qualification: 'model_qualification', qualification_basis: 'qualification_basis',
          priority: 'priority', reason: 'reason_for_inclusion',
        }
        const key = map[k]
        if (key) (o as unknown as Record<string, string>)[key] = nf(v)
      }
    }
    o.hq_in_country = !o.foreign_parent
    o.name = o.name || o.input_name
    return o
  })
}

export function parseContacts(text: string): (CiRawContacts & { input_name: string })[] {
  return blocks(text).map((b) => {
    const o: CiRawContacts & { input_name: string } = { input_name: b.name, people: [], offices: [], switchboard: null, approach: '' }
    for (const [k, v] of fields(b.body)) {
      if (k === 'person') { const [name, role, phone, mobile, email, url, ask] = pipe(v); if (nf(name)) o.people.push({ name: nf(name), role: nf(role), phone: nf(phone), mobile: nf(mobile), email: nf(email), source_url: nf(url), ask_for: nf(ask) }) }
      else if (k === 'office') { const [name, phone, email, url] = pipe(v); if (nf(name) && (nf(phone) || nf(email))) o.offices.push({ name: nf(name), phone: nf(phone), email: nf(email), source_url: nf(url) }) }
      else if (k === 'switchboard') { const [phone, email, address, url] = pipe(v); o.switchboard = { phone: nf(phone), email: nf(email), address: nf(address), source_url: nf(url) } }
      else if (k === 'approach') o.approach = nf(v)
    }
    return o
  })
}

// Pipe-separated answer lines → objects keyed by `cols`. The URL column is the first http(s) URL on the line.
export function parsePipeRows(text: string, cols: string[]): Record<string, string>[] {
  return text.split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim())
    .filter((l) => l.split('|').length >= cols.length - 1)
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((c) => !/^(theme|metric|year|event|name|institution|partner|company)$/i.test(c[0]) && !/^-+$/.test(c[0]))
    .map((c) => {
      const o: Record<string, string> = {}
      cols.forEach((k, i) => { o[k] = c[i] || '' })
      const u = (c.join(' ').match(/https?:\/\/[^\s)\]|]+/) || [''])[0].replace(/[.,;]+$/, '')
      if ('source_url' in o) o.source_url = u
      return o
    })
}

// Google grounding chunks whose supporting text spans fall inside [start, end) of the reply.
export function chunksForSpan(text: string, start: number, end: number, supports: { text: string; idx: number[] }[], chunks: { title: string; uri: string }[]) {
  const idx = new Set<number>()
  for (const s of supports) {
    const at = s.text ? text.indexOf(s.text.slice(0, 80)) : -1
    if (at >= start && at < end) s.idx.forEach((i) => idx.add(i))
  }
  return [...idx].map((i) => chunks[i]).filter(Boolean).slice(0, 12)
}

// The client's pasted list: sector header lines ("Defence & Security") followed by company lines.
export function parseClientList(text: string, sectorNames: string[]): { name: string; sector: string | null }[] {
  const out: { name: string; sector: string | null }[] = []
  const folded = sectorNames.map((s) => s.toLowerCase())
  let current: string | null = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()
    if (!line) continue
    const header = line.replace(/:$/, '')
    const hit = folded.indexOf(header.toLowerCase())
    if (hit >= 0) { current = sectorNames[hit]; continue }
    if (/:$/.test(line) || /^other (potential )?targets?$/i.test(header)) { current = null; continue }
    out.push({ name: line, sector: current })
  }
  return out
}
