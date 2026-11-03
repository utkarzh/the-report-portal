import type { InterviewType, MeetingPrepFinalSections } from '@/types'
import { splitPlanteoOutput, hasFixedScript } from '@/lib/meeting-prep'

// The meeting prep is one document (client request, Jira SCRUM-47, 2 Nov 2026:
// "generate the document at once … for each block you put regenerate, edit …
// just have everything in view"). This file owns its shape, shared by the
// workspace (screen), the final-document route (what the model writes) and
// the .docx export, so the three can't drift:
//   1–4  written by the final assembly pass, stored per block in
//        meeting_prep_sessions.final_sections (FINAL_BLOCKS below);
//   5    the presentation points, from presentation_points;
//   6    the planteo, from planteo_output (the Planteo Library script).
// Client-safe: no server imports.

export type FinalBlockKey = keyof MeetingPrepFinalSections

// `heading` finds the section in a whole document; `title` recognises the
// section's own title repeated at the top of its body (narrower: "### Quotes"
// opens What They've Said Recently and must stay).
export const FINAL_BLOCKS: { key: FinalBlockKey; marker: string; number: number; heading: RegExp; title: RegExp }[] = [
  { key: 'commercial_alert', marker: 'COMMERCIAL_ALERT', number: 1, heading: /commercial alert/i, title: /commercial alert/i },
  { key: 'snapshot', marker: 'SNAPSHOT', number: 2, heading: /snapshot/i, title: /snapshot/i },
  { key: 'motivation', marker: 'MOTIVATION', number: 3, heading: /motivation/i, title: /motivation profile/i },
  { key: 'said_recently', marker: 'SAID_RECENTLY', number: 4, heading: /said recently|quotes|news/i, title: /said recently/i },
]

export function isFinalBlockKey(v: unknown): v is FinalBlockKey {
  return FINAL_BLOCKS.some((b) => b.key === v)
}

export function finalBlockTitle(key: FinalBlockKey, type: InterviewType | string): string {
  switch (key) {
    case 'commercial_alert':
      return 'Commercial Alert'
    case 'snapshot':
      return type === 'company_ceo' ? 'Interviewee & Company Snapshot' : 'Interviewee & Organisation Snapshot'
    case 'motivation':
      return 'Motivation Profile Ranking'
    case 'said_recently':
      return 'What They’ve Said Recently'
  }
}

export const POINTS_TITLE = '3 Presentation Points'
export const PLANTEO_TITLE = 'Planteo Build-Up'
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

// The aperturador route sells nothing to the interviewee ("we're not
// offering him a full page… what we want out of him is to get in touch with
// these CEOs"), so the admin prompt's CEO recommendation rules can't apply
// to its Commercial Alert.
export function meetingTypeNoteForDocument(type: string): string {
  if (type !== 'aperturador') return ''
  return `\n\n--- MEETING TYPE: APERTURA (OPENING) MEETING ---\nThe interviewee is a Minister, the head of an industry association or a similar leader. No page, size or price is offered to them, so the CEO recommendation rules do not apply. In the Commercial Alert, state that this is an apertura meeting: the objective is for the interviewee to introduce TRC to the CEOs of the most important companies in the sector, by phone calls or with a letter. Then give the organisation's advertiser history. Do not show a Recommended Pitch.`
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
    if (/presentation points|planteo/i.test(title)) continue
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

// The planteo as it appears in the document (section 6). Fixed scripts are
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
        out.push(url ? `${label}: [download](${url})` : `${label}: download it from the meeting prep in the app.`)
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

export function composeFinalDocument(s: ComposeInput, opts: { resourceUrl?: (r: ScriptResource) => string | null } = {}): string {
  const sections = s.final_sections || {}
  const parts: string[] = []
  for (const b of FINAL_BLOCKS) {
    parts.push(`## ${b.number}. ${finalBlockTitle(b.key, s.interviewee_type)}\n\n${demoteHeadings(sections[b.key]?.trim() || '_Not written yet._')}`)
  }
  const points = (s.presentation_points || []).filter((p) => p.trim())
  parts.push(`## 5. ${POINTS_TITLE}\n\n${points.length ? points.map((p, i) => `${i + 1}. ${p.trim()}`).join('\n\n') : '_Not written yet._'}`)
  parts.push(`## 6. ${PLANTEO_TITLE}\n\n${planteoMarkdown(s.interviewee_type, s.planteo_output || '', opts)}`)
  return parts.join('\n\n')
}
