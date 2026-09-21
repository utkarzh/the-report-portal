// Server-side parsing + matching for the advertiser tracker spreadsheet(s)
// (e.g. "Georgia TP 2026.xlsx", or a single consolidated "TRC_Advertiser_
// History_FINAL.xlsx"). Matching is worldwide — every uploaded tracker's rows
// are pooled and searched by company name regardless of which label/country
// they were uploaded under (see the lookup route). We extract only the fields
// the Commercial Alert needs and match the interviewee's company by name.
import * as XLSX from 'xlsx'

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
}

// How many leading rows of a sheet we'll scan looking for the header row —
// consolidated trackers sometimes have a title/logo row above the real header.
const MAX_HEADER_SCAN_ROWS = 15

function normKey(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Normalise a company name for fuzzy matching: lowercase, strip a leading
// invisible/BOM char, punctuation, common suffixes and extra whitespace.
export function normalizeCompany(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[​-‏﻿]/g, '') // zero-width / BOM (seen in the sheet)
    .replace(/&/g, ' and ')
    .replace(/\b(ltd|llc|inc|plc|corp|co|company|group|holdings?|sa|jsc|llp)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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
  hasHistory: boolean
  status: 'yes' | 'no'
  details: string
  matchedRows: TrackerEntry[]
}

// A tracker row counts as real advertising history when it names a publication
// and either an ad size or a year (i.e. an actual placement, not just a lead).
function isPlacement(e: TrackerEntry): boolean {
  return Boolean(e.media && (e.ad_size || e.year))
}

// Find the interviewee's company across the (possibly multi-country) pool of
// tracker entries and derive an editable Commercial Alert. Matches on
// exact-normalized name first, then containment.
export function matchAdvertiserHistory(entries: TrackerEntry[], companyName: string): AdvertiserMatch {
  const target = normalizeCompany(companyName)
  if (!target) return { hasHistory: false, status: 'no', details: '', matchedRows: [] }

  const rows = entries.filter((e) => {
    const c = normalizeCompany(e.company)
    return c === target || c.includes(target) || target.includes(c)
  })

  const placements = rows.filter(isPlacement)
  if (placements.length === 0) {
    return { hasHistory: false, status: 'no', details: '', matchedRows: rows }
  }

  const details = placements
    .map((e) => {
      const parts = [e.country, e.media, e.ad_size, e.year].map((p) => p.trim()).filter(Boolean)
      return `• ${parts.join(' — ')}`
    })
    .join('\n')

  return { hasHistory: true, status: 'yes', details, matchedRows: rows }
}
