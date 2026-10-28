// Advertiser history for Business Cases: TRC's advertiser database (the
// Meeting Prep advertiser tracker rows) and the competitor-reports tracker,
// both narrowed to the project country.
//
// Before 28 Oct 2026 a Business Case saw neither in full. The advertiser
// database wasn't passed at all, and the competitor tracker (a 347k-char
// workbook uploaded as a "sample") was cut to its first 60k chars, which is
// only the 2026, 2025 and part of the 2024 sheets. So a Vietnam case claimed
// "first-mover advantage in USA Today" without having seen World Folio's May
// 2021 USA Today Vietnam report.
//
// The register itself (Appendix D2) is written by code, not by the model, so
// it lists every row exactly once and invents none. A large market (Japan:
// ~700 rows) would also cost a model tens of thousands of output tokens to
// copy out.
import * as XLSX from 'xlsx'
import { countrySearchTerms, mentionsCountry, sameCountry } from '@/lib/country-match'
import {
  displayYear,
  isPlacement,
  isUsableCompanyName,
  normalizeCompany,
  placementSource,
  placementSourceLabel,
  type TrackerEntry,
} from '@/lib/meeting-prep-tracker'

// Cap on rows handed to the model as context (~40 tokens each). The register
// in Appendix D2 is never capped.
const MAX_PROMPT_ROWS = 1500

const D2_HEADING = '### D2. Advertisers on record'

function yearOf(e: TrackerEntry): number {
  const m = String(e.year || '').match(/(19|20)\d{2}/)
  return m ? Number(m[0]) : 0
}

const SOURCE_ORDER = { trc: 0, competitor: 1, unverified: 2 } as const

// The project country's placements: usable company names only, one row per
// company + publication + year, TRC first, newest first.
export function advertiserRowsForCountry(entries: TrackerEntry[], country: string): TrackerEntry[] {
  if (!country.trim()) return []
  const seen = new Set<string>()
  const rows: TrackerEntry[] = []
  for (const e of entries) {
    if (!sameCountry(e.country, country) || !isPlacement(e) || !isUsableCompanyName(e.company)) continue
    const key = [normalizeCompany(e.company), normalizeCompany(e.media), yearOf(e) || e.year].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(e)
  }
  return rows.sort(
    (a, b) =>
      SOURCE_ORDER[placementSource(a)] - SOURCE_ORDER[placementSource(b)] ||
      yearOf(b) - yearOf(a) ||
      a.company.localeCompare(b.company),
  )
}

function cell(s: string | undefined): string {
  return String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim()
}

function counts(rows: TrackerEntry[]) {
  const c = { trc: 0, competitor: 0, unverified: 0 }
  for (const r of rows) c[placementSource(r)]++
  return c
}

// The records as context for the model, with what they mean and the rule
// that it must not write D2 itself.
export function advertiserRecordsBlock(rows: TrackerEntry[], country: string): string {
  const c = counts(rows)
  const header = `--- ADVERTISER HISTORY RECORDS: ${country} (from TRC's advertiser database) ---
The system selected every placement recorded for ${country}: ${rows.length} rows (${c.trc} TRC, ${c.competitor} competitor, ${c.unverified} unverified). Rows for other countries are left out.
- "TRC" rows are placements sold by TRC (including its Global FDI brand). Only these make a company a previous TRC advertiser.
- "Competitor" rows are placements with another agency's report: evidence of promotional appetite, not TRC history.
- "Unverified" rows were extracted automatically from report PDFs; the company name may be wrong. Never name one as a previous advertiser without saying it is unverified.
Use these rows in Section 2 (track record, previous TRC advertisers, competitor signals). Appendix D2 is inserted by the system from these same rows after your document: do NOT write D2 yourself.`
  if (rows.length === 0) {
    return `${header}\n\nNo placement for ${country} is recorded in the advertiser database.`
  }
  const lines = rows
    .slice(0, MAX_PROMPT_ROWS)
    .map((e) => [e.company, e.type, placementSourceLabel(e), e.media, displayYear(e.year), e.ad_size].map(cell).join(' | '))
  const more = rows.length > MAX_PROMPT_ROWS ? `\n(${rows.length - MAX_PROMPT_ROWS} older rows omitted here; all are in Appendix D2.)` : ''
  return `${header}\n\nCompany | Sector | TRC or competitor | Publication | Year | Ad size\n${lines.join('\n')}${more}`
}

export function advertiserRegisterMarkdown(rows: TrackerEntry[], country: string): string {
  if (rows.length === 0) {
    return `${D2_HEADING}\n\nNo placement for ${country} is recorded in TRC's advertiser database.`
  }
  const c = counts(rows)
  const intro = `Every placement for ${country} recorded in TRC's advertiser database: ${rows.length} (${c.trc} TRC, ${c.competitor} competitor, ${c.unverified} unverified). Unverified rows were extracted automatically from report PDFs and their company names may be wrong.`
  const table = rows.map((e) => {
    const source = e.link && /^https?:\/\//i.test(e.link.trim()) ? `[Report](${e.link.trim()})` : 'Advertiser database'
    return `| ${[e.company, e.type, placementSourceLabel(e), e.media, displayYear(e.year), e.ad_size].map(cell).join(' | ')} | ${source} |`
  })
  return `${D2_HEADING}\n\n${intro}\n\n| Company / entity | Sector | TRC or competitor | Publication | Year | Ad size or value | Source |\n|---|---|---|---|---|---|---|\n${table.join('\n')}`
}

// Append the register to a finished document, replacing any D2 the model
// wrote anyway, and adding the Appendix D heading if the model never got there.
export function attachAdvertiserRegister(output: string, rows: TrackerEntry[], country: string): string {
  let doc = output.replace(/\s+$/, '')
  const d2 = doc.search(/^#{2,4}\s*D2\b/m)
  if (d2 >= 0) {
    const rest = doc.slice(d2).search(/\n## /)
    doc = (rest >= 0 ? doc.slice(0, d2) + doc.slice(d2 + rest + 1) : doc.slice(0, d2)).replace(/\s+$/, '')
  }
  if (!/^## Appendix D\b/m.test(doc)) doc += '\n\n## Appendix D — Historical Advertiser Register'
  return `${doc}\n\n${advertiserRegisterMarkdown(rows, country)}\n`
}

// The competitor-reports workbook narrowed to the rows that mention the
// country, from every sheet, each sheet keeping its header row. Replaces the
// truncated whole-workbook text.
// One spreadsheet row as a CSV line, with line breaks inside a cell flattened
// (several tracker cells hold "Country\nPart 2" or a URL on its own line).
function csvLine(row: unknown[]): string {
  const cells = row.map((c) => String(c ?? '').replace(/\s*\n\s*/g, ' ').trim())
  while (cells.length && !cells[cells.length - 1]) cells.pop()
  return cells.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')
}

export function spreadsheetRowsForCountry(buffer: ArrayBuffer, country: string): { text: string; rows: number } {
  const terms = countrySearchTerms(country)
  const wb = XLSX.read(buffer, { type: 'array' })
  const parts: string[] = []
  let total = 0
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const lines = XLSX.utils
      .sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '', raw: false })
      .map(csvLine)
      .filter((l) => l.replace(/,/g, '').trim())
    const matches = lines.slice(1).filter((l) => mentionsCountry(l, terms))
    if (matches.length === 0) continue
    total += matches.length
    parts.push(`# Sheet: ${sheetName}\n\n${lines[0]}\n${matches.join('\n')}`)
  }
  const note = `(The system searched every sheet of this workbook for ${country} and kept the ${total} matching rows, each sheet with its header row. Rows for other countries are left out; for ${country} these records are complete across all the years the workbook covers.)`
  return { text: total ? `${note}\n\n${parts.join('\n\n')}` : `(The system searched every sheet of this workbook: no row mentions ${country}.)`, rows: total }
}
