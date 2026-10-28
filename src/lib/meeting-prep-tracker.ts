// Server-side parsing + matching for the advertiser tracker spreadsheet(s)
// (e.g. "Georgia TP 2026.xlsx", or a single consolidated "TRC_Advertiser_
// History_FINAL.xlsx"). Matching is worldwide — every uploaded tracker's rows
// are pooled and searched by company name regardless of which label/country
// they were uploaded under (see the lookup route). We extract only the fields
// the Commercial Alert needs and match the interviewee's company by name.
// Business Cases read the same rows, filtered to the project country
// (advertiser-register.ts).
import * as XLSX from 'xlsx'
import { sameCountry } from '@/lib/country-match'

export interface TrackerEntry {
  type: string        // TYPE OF INSTITUTION
  company: string      // COMPANY NAME
  status: string       // STATUS
  deal_owner: string   // DEAL OWNER
  city: string         // CITY
  notes: string        // NOTES
  revenue: string       // REVENUE
  ad_size: string        // AD SIZE
  media: string         // MEDIA
  year: string           // YEAR OF REPORT
  link: string          // LINK TO REPORT
  country: string       // COUNTRY / MARKET — from a country column if present, else the sheet name (multi-tab workbooks)
  // Who produced the placement. Optional because rows uploaded before 28 Oct
  // 2026 were parsed without them; such rows count as "unverified" until the
  // file is re-uploaded with Source Type / Agency columns.
  source?: string      // SOURCE TYPE, e.g. "TRC / Global FDI archive" or "Competitor history"
  agency?: string      // AGENCY that sold the report, e.g. "World Folio", "TRC"
}

// Header aliases → canonical field. Matched case-insensitively, ignoring
// punctuation/whitespace, so minor header variations across country files (and
// consolidated worldwide files, which tend to use their own naming) all work.
const HEADER_MAP: Record<string, keyof TrackerEntry> = {
  typeofinstitution: 'type',
  type: 'type',
  sector: 'type',
  category: 'type',
  companyname: 'company',
  company: 'company',
  institution: 'company',
  advertiser: 'company',
  advertisername: 'company',
  // Compound headers below are seen verbatim (post-normalization, so spaces/
  // slashes/punctuation are already stripped) in the real TRC worldwide
  // consolidated tracker — kept as exact aliases rather than a fuzzy/token
  // match so an unrelated header can't accidentally match a fragment of one.
  advertisercompanyname: 'company', // "Advertiser / Company Name"
  canonicaladvertiser: 'company',   // "Canonical Advertiser"
  client: 'company',
  clientname: 'company',
  brand: 'company',
  accountname: 'company',
  status: 'status',
  dealowner: 'deal_owner',
  owner: 'deal_owner',
  salesrep: 'deal_owner',
  city: 'city',
  notes: 'notes',
  comments: 'notes',
  remarks: 'notes',
  evidenceverification: 'notes', // "Evidence / Verification"
  revenue: 'revenue',
  value: 'revenue',
  adsize: 'ad_size',
  size: 'ad_size',
  space: 'ad_size',
  advertisingspace: 'ad_size', // "Advertising Space"
  linktoreport: 'link',
  link: 'link',
  url: 'link',
  sourceurlwebsite: 'link', // "Source URL / Website"
  media: 'media',
  publication: 'media',
  outlet: 'media',
  publisher: 'media',
  mediaoutlet: 'media',
  yearofreport: 'year',
  year: 'year',
  dateyear: 'year', // "Date / Year"
  country: 'country',
  market: 'country',
  region: 'country',
  countryreport: 'country',  // "Country / Report"
  marketreport: 'country',   // "Market / Report"
  primarycountry: 'country', // "Primary Country"
  sourcetype: 'source', // "Source Type" (master workbook: TRC / Global FDI archive vs Competitor history)
  source: 'source',     // "Source" ("Past Ads" sheet)
  agency: 'agency',
  mediaagency: 'agency',
  agencies: 'agency',
}

// How many leading rows of a sheet we'll scan looking for the header row —
// consolidated trackers sometimes have a title/logo row above the real header.
const MAX_HEADER_SCAN_ROWS = 15

function normKey(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Normalise a company name for matching: lowercase, strip accents, a leading
// invisible/BOM char, punctuation, legal-form suffixes and extra whitespace.
export function normalizeCompany(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[​-‏﻿]/g, '') // zero-width / BOM (seen in the sheet)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(
      /\b(ltd|limited|llc|inc|incorporated|plc|corp|corporation|co|company|group|holdings?|sa|sae|sas|spa|ag|gmbh|bv|nv|jsc|pjsc|llp|pty|pvt|kk)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

// Words that say nothing about WHICH company a name refers to. A name made only
// of these (after normalizeCompany) can't identify an advertiser, and a match
// that rests on one of them alone is a coincidence, not the same company.
const STOP_WORDS = new Set(['and', 'the', 'of', 'for', 'de', 'la', 'el', 'du', 'des', 'di'])
const GENERIC_WORDS = new Set([
  ...STOP_WORDS,
  'international', 'national', 'global', 'world', 'bank', 'banco', 'services', 'service',
  'industries', 'industry', 'enterprises', 'enterprise', 'investments', 'investment',
  'development', 'energy', 'trading', 'solutions', 'partners', 'ministry', 'authority',
  'agency', 'board', 'council', 'association', 'foundation', 'institute', 'university',
  'hotel', 'hotels', 'resort', 'resorts', 'airlines', 'airways', 'port', 'ports',
])

// A tracker row's company name is usable only if it actually names something.
// The uploaded "Worldwide 2.0" file has rows auto-extracted from report PDFs
// whose "company" is a bare legal suffix ("Company Ltd", "Group Corp",
// "Holdings Inc") or a sentence fragment ("In recent years, Armenia's
// health-"). The bare suffixes normalise to an empty string, and an empty
// string is contained in every name — so before this check those rows matched
// EVERY company looked up (45 of the 49 meeting preps from 13–28 Oct 2026 got
// the same five Ghana/Japan/Bahamas/Philippines "placements").
export function isUsableCompanyName(name: string): boolean {
  const raw = String(name || '').trim()
  if (!raw) return false
  // Sentence fragments: a multi-word lower-case start, a trailing
  // hyphen/colon/comma, a full stop between words, or the lower-case words of
  // a sentence ("Founded in 1920, NAIGAI has a"). Commas alone are fine:
  // "Ministry of Works and Housing, Antigua and Barbuda" is a real advertiser.
  const words = raw.split(/\s+/)
  if (!/\p{L}/u.test(raw)) return false // "53 54": a page number, not a name
  if (/^[a-z]/.test(raw) && words.length >= 3) return false
  if (/[-–:,]$/.test(raw)) return false
  if (/\.\s+\S/.test(raw) && words.length > 4) return false
  if (/\b(is|are|was|were|has|have|had|which|since|its|their|been|who|that)\b/.test(raw) && words.length >= 4) return false
  const norm = normalizeCompany(raw)
  const letters = norm.replace(/\s/g, '').length
  // Two characters only for an initialism written in capitals ("BP", "3M").
  if (letters < 2 || (letters === 2 && !/^[A-Z0-9]{2}$/.test(raw.replace(/[^A-Za-z0-9]/g, '')))) return false
  const tokens = norm.split(' ')
  if (tokens.length > 10) return false
  return tokens.some((t) => !STOP_WORDS.has(t) && t.length > 1)
}

function distinctiveTokens(tokens: string[]): string[] {
  return tokens.filter((t) => !GENERIC_WORDS.has(t) && t.length > 1)
}

// True when `inner` occurs as a run of whole words inside `outer`.
function containsWordRun(outer: string[], inner: string[]): boolean {
  if (inner.length === 0 || inner.length > outer.length) return false
  for (let i = 0; i + inner.length <= outer.length; i++) {
    if (inner.every((t, j) => outer[i + j] === t)) return true
  }
  return false
}

// Same company? Exact match after normalisation, or one name is the other plus
// extra words ("Bank of Valletta" / "Bank of Valletta Malta") — but only when
// the shorter name has at least two distinctive words. One shared word is never
// enough: "Riken Yamamoto & Field Shop" is not "Yamamoto Corporation", and
// "ENI" is not "Benin Direction" (which the old letter-by-letter substring
// test matched).
export function isSameCompany(a: string, b: string): boolean {
  const na = normalizeCompany(a)
  const nb = normalizeCompany(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ta = na.split(' ')
  const tb = nb.split(' ')
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  return distinctiveTokens(shorter).length >= 2 && containsWordRun(longer, shorter)
}

export type PlacementSource = 'trc' | 'competitor' | 'unverified'

const TRC_RE = /\b(trc|gfdi|global fdi|the report company)\b/i

// Who produced a placement: TRC (incl. its Global FDI brand), a competitor, or
// unknown. Uses the row's Source Type when present, then its agency. A row
// auto-extracted from a report PDF with neither is "unverified": its company
// name came from text extraction and is often wrong (e.g. the "Yamamoto
// Corporation" rows are Nitto Pack and Toyo Paper ads).
export function placementSource(e: TrackerEntry): PlacementSource {
  const source = (e.source || '').trim()
  if (source) {
    if (TRC_RE.test(source)) return 'trc'
    if (/competitor/i.test(source)) return 'competitor'
  }
  const agency = (e.agency || '').trim()
  if (agency) return TRC_RE.test(agency) ? 'trc' : 'competitor'
  return 'unverified'
}

export function placementSourceLabel(e: TrackerEntry): string {
  const s = placementSource(e)
  if (s === 'trc') return 'TRC'
  if (s === 'competitor') return e.agency ? `Competitor (${e.agency})` : 'Competitor'
  return 'Unverified (auto-extracted from a report)'
}

// "2021-08-01 00:00:00" → "Aug 2021"; anything else is kept as written.
export function displayYear(year: string): string {
  const m = String(year || '').match(/^(\d{4})-(\d{2})-\d{2}/)
  if (!m) return String(year || '').trim()
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]
  return month ? `${month} ${m[1]}` : m[1]
}

// Find the header row within a sheet's raw rows: the row (within the first
// MAX_HEADER_SCAN_ROWS) that maps the most distinct known fields, provided it
// maps 'company' — required, since a row of stray labels with no company
// column isn't a usable tracker header. The score (distinct mapped fields) is
// returned so the caller can compare richness across a workbook's sheets.
function detectHeaderRow(
  rows: (string | number)[][],
): { headerIndex: number; header: (keyof TrackerEntry | undefined)[]; score: number } | null {
  let best: { headerIndex: number; header: (keyof TrackerEntry | undefined)[]; score: number } | null = null
  const scanLimit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS)

  for (let i = 0; i < scanLimit; i++) {
    const header = rows[i].map((h) => HEADER_MAP[normKey(String(h))])
    const mappedFields = new Set(header.filter(Boolean))
    if (!mappedFields.has('company')) continue
    if (mappedFields.size >= 2 && (!best || mappedFields.size > best.score)) {
      best = { headerIndex: i, header, score: mappedFields.size }
    }
  }
  return best
}

function parseSheetRows(
  rows: (string | number)[][],
  headerIndex: number,
  header: (keyof TrackerEntry | undefined)[],
  fallbackCountry: string,
): TrackerEntry[] {
  const entries: TrackerEntry[] = []
  for (const row of rows.slice(headerIndex + 1)) {
    const e: TrackerEntry = {
      type: '', company: '', status: '', deal_owner: '', city: '',
      notes: '', revenue: '', ad_size: '', media: '', year: '', link: '', country: '',
    }
    let any = false
    row.forEach((cell, i) => {
      const field = header[i]
      if (!field) return
      const val = String(cell ?? '').trim()
      if (!val) return
      // Several source columns commonly alias to the same field (e.g. a
      // specific "Country" plus a broader "Region", or a canonical name
      // column plus a raw one) — the first one wins so the more specific,
      // earlier column isn't clobbered by a later, vaguer duplicate. NOTES is
      // the deliberate exception: multiple notes-like columns (Notes,
      // Evidence/Verification…) are genuinely complementary, so those accumulate.
      if (field === 'notes') e.notes = e.notes ? `${e.notes} — ${val}` : val
      else if (!e[field]) e[field] = val
      any = true
    })
    if (any && e.company) {
      if (!e.country) e.country = fallbackCountry
      entries.push(e)
    }
  }
  return entries
}

// Parse an uploaded workbook buffer into normalized entries. A workbook can
// carry several sheets that are really just different VIEWS of the same
// underlying placements — e.g. a summary dashboard, a raw import tab, and a
// richer enriched/master tab with extra columns (sector, verification, source
// links…) — so instead of pooling every sheet (which would double-count rows
// present in more than one view), we score every sheet by how many distinct
// canonical fields its header maps and parse only the richest-schema sheet(s).
// Ties are merged, which is exactly the right behaviour for a genuine
// one-tab-per-country workbook where every tab shares the same schema.
export function parseTrackerWorkbook(buffer: Buffer | ArrayBuffer): TrackerEntry[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })

  const candidates: { sheetName: string; headerIndex: number; header: (keyof TrackerEntry | undefined)[]; rows: (string | number)[][]; score: number }[] = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false, defval: '' })
    if (rows.length < 2) continue
    const detected = detectHeaderRow(rows)
    if (!detected) continue
    candidates.push({ sheetName, rows, ...detected })
  }
  if (candidates.length === 0) return []

  const bestScore = Math.max(...candidates.map((c) => c.score))
  const winners = candidates.filter((c) => c.score === bestScore)
  // Only tag rows with the sheet name as a country fallback when several
  // sheets are actually being combined (the multi-tab-per-country case) — a
  // single winning sheet's own country column (if any) is left as parsed.
  const tagByCountry = winners.length > 1

  const entries: TrackerEntry[] = []
  for (const { sheetName, headerIndex, header, rows } of winners) {
    entries.push(...parseSheetRows(rows, headerIndex, header, tagByCountry ? sheetName.trim() : ''))
  }
  return entries
}

export interface AdvertiserMatch {
  /** A TRC placement was found: the company is a previous TRC advertiser. */
  hasHistory: boolean
  status: 'yes' | 'no'
  /** The TRC placements, one line each. This is what reaches the AI. */
  details: string
  matchedRows: TrackerEntry[]
  /** Placements with competitors, or auto-extracted and unverified. Shown to
   *  the rep as context; never passed on as TRC history, so they can't
   *  trigger the planteo's "Ex-Advertiser → previous Ad Size" rule. */
  otherPlacements: string
  /** Same-country names sharing a distinctive word that were NOT matched, for
   *  the rep to check by eye ("Toyota Motor" vs "Toyota Group"). */
  similarNames: string[]
}

// A tracker row counts as real advertising history when it names a publication
// and either an ad size or a year (i.e. an actual placement, not just a lead).
export function isPlacement(e: TrackerEntry): boolean {
  return Boolean(e.media && (e.ad_size || e.year))
}

function placementLine(e: TrackerEntry, withSource: boolean): string {
  const parts = [e.country, e.media, e.ad_size, displayYear(e.year)].map((p) => (p || '').trim()).filter(Boolean)
  return `• ${parts.join(' — ')}${withSource ? ` (${placementSourceLabel(e)})` : ''}`
}

// Find the interviewee's company in the pooled tracker entries and derive an
// editable Commercial Alert. Only usable names, only same-company matches
// (isSameCompany), and only TRC placements count as history. Rows from the
// company's own country are listed first; a same-name match elsewhere is kept,
// because a group can advertise in another market's report.
export function matchAdvertiserHistory(
  entries: TrackerEntry[],
  companyName: string,
  country = '',
): AdvertiserMatch {
  const empty: AdvertiserMatch = { hasHistory: false, status: 'no', details: '', matchedRows: [], otherPlacements: '', similarNames: [] }
  if (!isUsableCompanyName(companyName)) return empty

  const usable = entries.filter((e) => isUsableCompanyName(e.company))
  const homeFirst = (a: TrackerEntry, b: TrackerEntry) =>
    Number(sameCountry(b.country, country)) - Number(sameCountry(a.country, country))
  const rows = usable.filter((e) => isSameCompany(e.company, companyName)).sort(homeFirst)

  const placements = rows.filter(isPlacement)
  const trc = placements.filter((e) => placementSource(e) === 'trc')
  const other = placements.filter((e) => placementSource(e) !== 'trc')

  const targetWords = new Set(distinctiveTokens(normalizeCompany(companyName).split(' ')).filter((t) => t.length >= 4))
  const matched = new Set(rows.map((e) => e.company))
  const similarNames = [
    ...new Set(
      usable
        .filter((e) => !matched.has(e.company) && country && sameCountry(e.country, country))
        .filter((e) => normalizeCompany(e.company).split(' ').some((t) => targetWords.has(t)))
        .map((e) => e.company.trim()),
    ),
  ].slice(0, 6)

  return {
    hasHistory: trc.length > 0,
    status: trc.length > 0 ? 'yes' : 'no',
    details: trc.map((e) => placementLine(e, false)).join('\n'),
    matchedRows: rows,
    otherPlacements: other.map((e) => placementLine(e, true)).join('\n'),
    similarNames,
  }
}
