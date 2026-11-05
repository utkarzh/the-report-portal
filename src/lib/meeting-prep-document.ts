import type { InterviewType, MeetingPrepFinalSections } from '@/types'
import { splitPlanteoOutput, hasFixedScript } from '@/lib/meeting-prep'

// The meeting prep is one document (client request, Jira SCRUM-47, 2 Nov 2026:
// "generate the document at once … for each block you put regenerate, edit …
// just have everything in view"). This file owns its shape, shared by the
// workspace (screen), the final-document route (what the model writes) and
// the .docx export, so the three can't drift.
//
// Order set by the CEO (Nov 2026): the three blocks a rep needs in the room
// come first and open; the rest collapse, in their previous order.
//   1    Recommended Space to Pitch and Commercial Alerts
//   2    the presentation points, from presentation_points
//   3    the planteo, from planteo_output (the Planteo Library script)
//   4–6  Snapshot, Motivation, What They've Said
// Blocks 1 and 4–6 are written by the final assembly pass, stored per block in
// meeting_prep_sessions.final_sections (FINAL_BLOCKS below).
// Client-safe: no server imports.

export type FinalBlockKey = keyof MeetingPrepFinalSections

// `heading` finds the section in a whole document; `title` recognises the
// section's own title repeated at the top of its body (narrower: "### Quotes"
// opens What They've Said Recently and must stay).
export const FINAL_BLOCKS: { key: FinalBlockKey; marker: string; number: number; heading: RegExp; title: RegExp }[] = [
  { key: 'commercial_alert', marker: 'COMMERCIAL_ALERT', number: 1, heading: /commercial alert/i, title: /commercial alert|recommended space/i },
  { key: 'snapshot', marker: 'SNAPSHOT', number: 4, heading: /snapshot/i, title: /snapshot/i },
  { key: 'motivation', marker: 'MOTIVATION', number: 5, heading: /motivation/i, title: /motivation profile/i },
  { key: 'said_recently', marker: 'SAID_RECENTLY', number: 6, heading: /said recently|quotes|news/i, title: /said recently/i },
]

// The blocks after the planteo, which start collapsed.
export const COLLAPSIBLE_BLOCKS = FINAL_BLOCKS.filter((b) => b.key !== 'commercial_alert')

export function isFinalBlockKey(v: unknown): v is FinalBlockKey {
  return FINAL_BLOCKS.some((b) => b.key === v)
}

export function finalBlockTitle(key: FinalBlockKey, type: InterviewType | string): string {
  switch (key) {
    case 'commercial_alert':
      return 'Recommended Space to Pitch and Commercial Alerts'
    case 'snapshot':
      return type === 'company_ceo' ? 'Interviewee & Company Snapshot' : 'Interviewee & Organisation Snapshot'
    case 'motivation':
      return 'Motivation Profile Ranking'
    case 'said_recently':
      return 'What They’ve Said Recently'
  }
}

export const POINTS_TITLE = 'Three Points for Your Presentation (“Why You”)'
export const POINTS_NUMBER = 2
export const PLANTEO_TITLE = 'Planteo Build-Up'
export const PLANTEO_NUMBER = 3
// The client's words: "Deliver this script for the planteo … this is exactly
// what they have to say, and they are missing it."
export const DELIVER_SCRIPT_TITLE = 'Deliver this exact script for the planteo'

// Appended LAST to the final-document system prompt so it wins over the admin
// prompt's own "produce sections 1–6" structure: points and planteo are now
// inserted by code, and the markers let one block be replaced on its own.
export function finalBlocksContract(): string {
  return `--- OUTPUT FORMAT FOR THIS CALL (system rule: overrides any section list or format given above) ---
Write ONLY sections 1 to 4 of the document: Commercial Alert, Interviewee Snapshot, Motivation Profile Ranking, What They've Said Recently. Sections 5 (3 Presentation Points) and 6 (Planteo Build-Up) are inserted by the system, word for word, from the approved material: do not write them. Do not write a document title, header or cover line.

Start each section with its marker, alone on its own line, in this order:
${FINAL_BLOCKS.map((b) => `<<<BLOCK:${b.marker}>>>`).join('\n')}

Write the section's content directly under its marker. Do not repeat the section title as a heading. Inside a section use ### sub-headings only where they help (for example "### Quotes" and "### News"). Write nothing after the fourth section.`
}

// The CEO's standing guidance, word for word, shown at the top of Block 1 for
// every meeting that isn't with a company CEO ("the default text to put in this
// block for everyone"). Printed by code, so no model or edit can change it.
export const MINISTER_GUIDANCE = `As a general rule, aim for aperturas (referrals) to companies and other entities. See below in this page how this is done.

If you are meeting a Prime Minister, President or any other individual you believe may have the authority to sign a deal directly (e.g. the Ministry has been a previous advertiser), always consult your manager. There may be exceptions where we pursue a direct pitch to the Minister instead of company aperturas. There are also hybrid approaches where we can pursue both.`

export function showsMinisterGuidance(type: InterviewType | string): boolean {
  return type !== 'company_ceo'
}

// Ministers and heads of associations aren't sold a page by default, so the
// admin prompt's CEO recommendation rules can't apply to their Commercial
// Alert, and code already prints the guidance and advertiser record above it.
export function meetingTypeNoteForDocument(type: string): string {
  if (!showsMinisterGuidance(type)) return ''
  return `\n\n--- MEETING TYPE: MINISTER OR HEAD OF AN ORGANISATION ---\nThe interviewee is a Minister, the head of an industry association or a similar leader. No page, size or price is recommended for them, so the CEO recommendation rules do not apply: do not show a Recommended Pitch. The system prints the standing guidance for these meetings (aim for aperturas) and the organisation's advertiser record at the top of this section: do not repeat either. In the Commercial Alert, write only what is specific to this person or organisation that the representative should know before the meeting. If there is nothing, say so in one short sentence.`
}

// ── Advertiser record ────────────────────────────────────────────────────
// Whether the company or organisation has advertised with TRC or a competitor.
// Printed by code in Block 1 from the rep's answer and the advertiser tracker,
// never by the model, so it can't be invented or dropped.
export interface AdvertiserRecord {
  // False when the tracker couldn't be searched, so "nothing found" would mislead.
  checked: boolean
  trc: string[]
  competitor: string[]
  unverified: string[]
}

const MAX_RECORD_LINES = 5

function recordList(label: string, lines: string[]): string {
  const shown = lines.slice(0, MAX_RECORD_LINES).map((l) => `- ${escapeMd(l)}`)
  if (lines.length > MAX_RECORD_LINES) shown.push(`- and ${lines.length - MAX_RECORD_LINES} more`)
  return `**${label}**\n\n${shown.join('\n')}`
}

export function advertiserRecordMarkdown(record: AdvertiserRecord, type: InterviewType | string): string {
  const who = type === 'company_ceo' ? 'This company' : 'This organisation'
  const { trc, competitor, unverified, checked } = record
  const headline = trc.length && competitor.length
    ? `${who} has advertised with TRC and with a competitor.`
    : trc.length
      ? `${who} has advertised with TRC.`
      : competitor.length
        ? `${who} has advertised with a competitor, not with TRC.`
        : !checked
          ? 'Not checked against the advertiser tracker.'
          : unverified.length
            ? 'No confirmed advertising with TRC or a competitor.'
            : 'No previous advertising found with TRC or a competitor.'
  const parts = [`**Previous advertising:** ${headline}`]
  if (trc.length) parts.push(recordList('With TRC', trc))
  if (competitor.length) parts.push(recordList('With a competitor', competitor))
  if (unverified.length) parts.push(recordList('Possible placements, source not verified', unverified))
  return parts.join('\n\n')
}

// Strip what a block should never start or end with: a repeated title line
// ("## 1. COMMERCIAL ALERT") and the "---" rules the model puts between
// sections.
function cleanBlock(body: string, title: RegExp): string {
  const lines = body.replace(/\r/g, '').split('\n')
  while (lines.length && (!lines[0].trim() || /^-{3,}\s*$/.test(lines[0].trim()))) lines.shift()
  if (lines.length && isHeadingLine(lines[0]) && title.test(lines[0]) && lines[0].replace(/[#*_\d.\s]/g, '').length < 60) lines.shift()
  while (lines.length && (!lines[0].trim() || /^-{3,}\s*$/.test(lines[0].trim()))) lines.shift()
  while (lines.length && (!lines[lines.length - 1].trim() || /^-{3,}\s*$/.test(lines[lines.length - 1].trim()))) lines.pop()
  return lines.join('\n').trim()
}

function isHeadingLine(line: string): boolean {
  const t = line.trim()
  return /^#{1,3}\s+\S/.test(t) || /^\*\*[^*]+\*\*:?$/.test(t)
}

// Top-level section boundaries in a whole document: "# …" / "## …" headings.
// "### Quotes" inside a section is not one. Only a document with no such
// headings at all falls back to lines that are entirely bold — otherwise a
// bold quote or news headline would cut its section short.
function isMarkdownSectionHeading(line: string): boolean {
  return /^#{1,2}\s+\S/.test(line.trim())
}
function isBoldLine(line: string): boolean {
  return /^\*\*[^*]+\*\*:?$/.test(line.trim())
}

// Reads the four blocks out of the model's reply. Markers first; otherwise
// (a format miss, or a document written before migration 044, whose sections
// are "## 1. COMMERCIAL ALERT" … "## 6. PLANTEO BUILD-UP") the numbered
// top-level headings.
export function parseFinalSections(text: string): MeetingPrepFinalSections {
  const out: MeetingPrepFinalSections = {}
  const markerRe = /<<<\s*BLOCK\s*:\s*([A-Z_]+)\s*>>>/g
  const matches = [...text.matchAll(markerRe)]
  for (let i = 0; i < matches.length; i++) {
    const block = FINAL_BLOCKS.find((b) => b.marker === matches[i][1].toUpperCase())
    if (!block || out[block.key]) continue
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const body = cleanBlock(text.slice(start, end), block.title)
    if (body) out[block.key] = body
  }
  if (finalSectionsComplete(out)) return out

  const lines = text.replace(/\r/g, '').split('\n')
  const isBoundary = lines.some(isMarkdownSectionHeading) ? isMarkdownSectionHeading : isBoldLine
  const boundaries = lines.map((l, i) => (isBoundary(l) ? i : -1)).filter((i) => i >= 0)
  for (let b = 0; b < boundaries.length; b++) {
    const lineIdx = boundaries[b]
    const title = lines[lineIdx].replace(/[#*_]/g, '').replace(/^\s*\d+\s*[.)]\s*/, '').trim()
    if (title.length > 70) continue
    // Sections 5 and 6 are never taken from the text: they come from their
    // own columns. Matching them here would let "quotes" swallow a heading.
    if (/presentation points|three points|planteo/i.test(title)) continue
    const block = FINAL_BLOCKS.find((fb) => fb.heading.test(title))
    if (!block || out[block.key]) continue
    const end = b + 1 < boundaries.length ? boundaries[b + 1] : lines.length
    const body = cleanBlock(lines.slice(lineIdx + 1, end).join('\n'), block.title)
    if (body) out[block.key] = body
  }
  return out
}

// The document's four AI blocks: the stored ones, or (a document written
// before migration 044, or a database that hasn't run it) the ones read back
// out of final_output.
export function finalSectionsOf(s: { final_sections?: MeetingPrepFinalSections | null; final_output?: string | null }): MeetingPrepFinalSections {
  const stored = s.final_sections
  if (stored && Object.values(stored).some((v) => typeof v === 'string' && v.trim())) return stored
  return s.final_output ? parseFinalSections(s.final_output) : {}
}

export function finalSectionsComplete(s: MeetingPrepFinalSections | null | undefined): boolean {
  return Boolean(s && FINAL_BLOCKS.every((b) => s[b.key]?.trim()))
}

export function missingFinalBlocks(s: MeetingPrepFinalSections): string[] {
  return FINAL_BLOCKS.filter((b) => !s[b.key]?.trim()).map((b) => finalBlockTitle(b.key, 'company_ceo'))
}

// Headings inside a block must sit below the document's own section headings,
// otherwise a "# PLANTEO BUILD-UP" the model wrote becomes a new section in
// the .docx and breaks the numbering.
export function demoteHeadings(md: string): string {
  return md.replace(/^(\s*)#{1,2}(\s+)/gm, '$1###$2')
}

// ── The planteo script ───────────────────────────────────────────────────
// The Planteo Library's fixed scripts (CEO, aperturador) mix three things the
// client wants told apart at a glance: the words to say (in quotation marks),
// the instructions to the rep (in CAPITALS, "these are our instructions to the
// teams"), and, for the aperturador, the sample-file downloads and the notes
// and tips. parseScript() splits the text into those pieces so the screen and
// the .docx can style each one.

export type ScriptResource = 'apertura_letter' | 'apertura_list'

export interface ScriptSegment {
  kind: 'spoken' | 'direction' | 'note' | 'download' | 'tips_heading' | 'tip'
  text: string
  resource?: ScriptResource
}

function mostlyUpperCase(p: string): boolean {
  const letters = p.replace(/[^A-Za-z]/g, '')
  if (letters.length < 8) return false
  const upper = letters.replace(/[^A-Z]/g, '').length
  return upper / letters.length >= 0.85
}

const OPEN_QUOTE = /^["“]/
const CLOSE_QUOTE = /["”]\s*$/

export function parseScript(text: string): ScriptSegment[] {
  const paragraphs = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const out: ScriptSegment[] = []
  let inQuote = false
  let inTips = false
  for (const p of paragraphs) {
    const opens = OPEN_QUOTE.test(p)
    // A quote left open by a missing closing mark must not swallow the next
    // instruction: a paragraph in capitals always ends it.
    if (inQuote && !opens && mostlyUpperCase(p)) inQuote = false
    if (inQuote || opens) {
      out.push({ kind: 'spoken', text: p })
      // A paragraph that opens and closes ("Do you think …?") ends the quote;
      // one that only opens carries on to the next paragraph.
      inQuote = !CLOSE_QUOTE.test(p)
      continue
    }
    if (/\(\s*download link\s*\)|download\b[^.]*\bhere\b/i.test(p)) {
      const resource: ScriptResource = /letter/i.test(p) ? 'apertura_letter' : 'apertura_list'
      out.push({ kind: 'download', text: p, resource })
      continue
    }
    if (/^#*\s*\**\s*notes\s*(and|&)\s*tips\b/i.test(p)) {
      inTips = true
      out.push({ kind: 'tips_heading', text: 'Notes and tips' })
      continue
    }
    if (inTips) {
      for (const line of p.split('\n').map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean)) {
        out.push({ kind: 'tip', text: line })
      }
      continue
    }
    if (/^\*(?!\*)/.test(p)) {
      out.push({ kind: 'note', text: p.replace(/^\*\s*/, '') })
      continue
    }
    // Anything else outside the quotes tells the rep what to do ("Now let
    // him/her reply before the negotiation begins.").
    out.push({ kind: 'direction', text: p })
  }
  return out
}

// Inline pieces of a spoken paragraph: "(message 2 taken from the
// conversation)" is a gap the rep fills in live; "(HAND IT OVER FOR HIM TO
// READ)" is an action, not words to say.
export interface SpokenPart {
  kind: 'text' | 'gap' | 'action'
  text: string
}

export function spokenParts(paragraph: string): SpokenPart[] {
  const parts: SpokenPart[] = []
  for (const piece of paragraph.split(/(\([^()]*\))/)) {
    if (!piece) continue
    if (/^\(.*\)$/.test(piece)) {
      parts.push({ kind: mostlyUpperCase(piece) ? 'action' : 'gap', text: piece })
    } else {
      parts.push({ kind: 'text', text: piece })
    }
  }
  return parts
}

export function scriptResourceLabel(r: ScriptResource): string {
  return r === 'apertura_letter' ? 'Sample apertura letter' : 'Sample company apertura list format'
}

function escapeMd(s: string): string {
  return s.replace(/([*_`\\])/g, '\\$1')
}

// A fixed script is laid out line by line; anything else — the Government
// Official write-up, or a CEO planteo from before the verbatim formula,
// which has no quoted lines — is shown as the model wrote it.
export function usesVerbatimScript(type: InterviewType | string, segments: ScriptSegment[]): boolean {
  return hasFixedScript(type) && segments.some((s) => s.kind === 'spoken')
}

// The planteo as it appears in the document (block 3). Fixed scripts are
// rebuilt from parseScript(): the words to say in bold italics under "Deliver
// this exact script" ("put it in cursive and bold"), instructions in bold.
// The Government Official planteo is the model's own write-up, kept as
// written.
export function planteoMarkdown(type: InterviewType | string, planteoOutput: string, opts: { resourceUrl?: (r: ScriptResource) => string | null } = {}): string {
  // The CEO recommendation (ahead of the marker) is shown in the Commercial
  // Alert, as in the client's document; this section holds what is delivered.
  const { script } = splitPlanteoOutput(planteoOutput || '')
  if (!script.trim()) return '_Not written yet._'

  const segments = parseScript(script)
  if (!usesVerbatimScript(type, segments)) {
    return demoteHeadings(script.replace(/^\s*-{3,}\s*$/gm, '').trim())
  }

  const out: string[] = [`**${DELIVER_SCRIPT_TITLE.toUpperCase()}**`]
  for (const seg of segments) {
    switch (seg.kind) {
      case 'spoken':
        out.push(`***${escapeMd(seg.text)}***`)
        break
      case 'direction':
        out.push(`**${escapeMd(seg.text)}**`)
        break
      case 'note':
        // The script's own footnote, kept with its asterisk ("message* 1").
        out.push(`\\*${escapeMd(seg.text)}`)
        break
      case 'download': {
        const url = seg.resource ? opts.resourceUrl?.(seg.resource) : null
        const label = seg.resource ? scriptResourceLabel(seg.resource) : 'Sample file'
        // Only a file an admin has actually uploaded gets a line.
        if (url) out.push(`${label}: [download](${url})`)
        break
      }
      case 'tips_heading':
        out.push('**Notes and tips**')
        break
      case 'tip':
        out.push(`- ${escapeMd(seg.text)}`)
        break
    }
  }
  // Consecutive tips must stay one list, not one list per paragraph.
  return out.join('\n\n').replace(/(^- .*)\n\n(?=- )/gm, '$1\n')
}

// ── The whole document ───────────────────────────────────────────────────

export interface ComposeInput {
  interviewee_type: InterviewType | string
  final_sections?: MeetingPrepFinalSections | null
  presentation_points?: string[] | null
  planteo_output?: string | null
}

// Same order as the screen. The advertiser record is read live from the tracker,
// so only the download passes it; the stored final_output leaves it out.
export function composeFinalDocument(
  s: ComposeInput,
  opts: { resourceUrl?: (r: ScriptResource) => string | null; advertiser?: AdvertiserRecord } = {},
): string {
  const sections = s.final_sections || {}
  const type = s.interviewee_type
  const blockBody = (key: FinalBlockKey) => demoteHeadings(sections[key]?.trim() || '_Not written yet._')
  const record = opts.advertiser ? advertiserRecordMarkdown(opts.advertiser, type) : ''

  // Ministers: the standing guidance and record lead. CEOs: the recommended
  // space leads, then the record.
  const alert = showsMinisterGuidance(type)
    ? [MINISTER_GUIDANCE, record, blockBody('commercial_alert')]
    : [blockBody('commercial_alert'), record]

  const points = (s.presentation_points || []).filter((p) => p.trim())
  const parts = [
    `## 1. ${finalBlockTitle('commercial_alert', type)}\n\n${alert.filter(Boolean).join('\n\n')}`,
    `## ${POINTS_NUMBER}. ${POINTS_TITLE}\n\n${points.length ? points.map((p, i) => `${i + 1}. ${p.trim()}`).join('\n\n') : '_Not written yet._'}`,
    `## ${PLANTEO_NUMBER}. ${PLANTEO_TITLE}\n\n${planteoMarkdown(type, s.planteo_output || '', opts)}`,
    ...COLLAPSIBLE_BLOCKS.map((b) => `## ${b.number}. ${finalBlockTitle(b.key, type)}\n\n${blockBody(b.key)}`),
  ]
  return parts.join('\n\n')
}
