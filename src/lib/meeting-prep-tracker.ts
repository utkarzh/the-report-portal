// Server-side parsing + matching for the per-country advertiser tracker
// spreadsheet (e.g. "Georgia TP 2026.xlsx"). One sheet, one row per
// institution. We extract only the fields the Commercial Alert needs and match
// the interviewee's company by name.
import * as XLSX from 'xlsx'

export interface TrackerEntry {
  type: string        // TYPE OF INSTITUTION
  company: string     // COMPANY NAME
  status: string      // STATUS
  deal_owner: string  // DEAL OWNER
  city: string        // CITY
  notes: string       // NOTES
  revenue: string     // REVENUE
  ad_size: string     // AD SIZE
  media: string       // MEDIA
  year: string        // YEAR OF REPORT
  link: string        // LINK TO REPORT
}

// Header aliases → canonical field. Matched case-insensitively, ignoring
// punctuation/whitespace, so minor header variations across country files work.
const HEADER_MAP: Record<string, keyof TrackerEntry> = {
  typeofinstitution: 'type',
  type: 'type',
  companyname: 'company',
  company: 'company',
  institution: 'company',
  status: 'status',
  dealowner: 'deal_owner',
  owner: 'deal_owner',
  city: 'city',
  notes: 'notes',
  revenue: 'revenue',
  adsize: 'ad_size',
  linktoreport: 'link',
  link: 'link',
  media: 'media',
  publication: 'media',
  yearofreport: 'year',
  year: 'year',
}

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

// Parse an uploaded .xlsx buffer into normalized entries (first non-empty sheet).
export function parseTrackerWorkbook(buffer: Buffer | ArrayBuffer): TrackerEntry[] {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, blankrows: false, defval: '' })
  if (rows.length < 2) return []

  // First row is the header; map each column index to a canonical field.
  const header = rows[0].map((h) => HEADER_MAP[normKey(String(h))])
  const entries: TrackerEntry[] = []

  for (const row of rows.slice(1)) {
    const e: TrackerEntry = {
      type: '', company: '', status: '', deal_owner: '', city: '',
      notes: '', revenue: '', ad_size: '', media: '', year: '', link: '',
    }
    let any = false
    row.forEach((cell, i) => {
      const field = header[i]
      if (!field) return
      const val = String(cell ?? '').trim()
      if (!val) return
      // Two NOTES columns exist in the sheet; keep the first non-empty, append the rest.
      if (field === 'notes' && e.notes) e.notes = `${e.notes} — ${val}`
      else e[field] = val
      any = true
    })
    if (any && e.company) entries.push(e)
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

// Find the interviewee's company in the tracker and derive an editable
// Commercial Alert. Matches on exact-normalized name first, then containment.
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
      const parts = [e.media, e.ad_size, e.year].map((p) => p.trim()).filter(Boolean)
      return `• ${parts.join(' — ')}`
    })
    .join('\n')

  return { hasHistory: true, status: 'yes', details, matchedRows: rows }
}
