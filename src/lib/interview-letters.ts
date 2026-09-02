import type { InterviewLetterCompany, InterviewLetterParagraphSlot } from '@/types'

export const INTERVIEW_LETTER_COMPANIES: { value: InterviewLetterCompany; label: string }[] = [
  { value: 'TRC', label: 'The Report Company (TRC)' },
  { value: 'GFDI', label: 'Global Foreign Direct Investment (GFDI)' },
]

export function isInterviewLetterCompany(v: unknown): v is InterviewLetterCompany {
  return v === 'TRC' || v === 'GFDI'
}

// Appended after every Claude call in this module that has no marker of its
// own to anchor on (letter regenerate, email generate/regenerate, personalize).
// A small, deliberate duplicate of meeting-prep's OUTPUT_MARKER trio — each
// module owns its own self-contained lib file rather than sharing one across
// unrelated features. See src/lib/meeting-prep.ts for the original rationale:
// a literal marker is a parsing contract the model can't route around the way
// it can ignore a prose "don't narrate" instruction.
export const OUTPUT_MARKER = '<<<OUTPUT>>>'

export const NO_PREAMBLE_INSTRUCTION = `Before writing anything else, output the literal line ${OUTPUT_MARKER} on its own line, with nothing before it — no greeting, no plan, no explanation. Immediately after that line, write ONLY the requested output itself: no preamble, no meta-commentary about what you're doing, no closing remarks. Never write things like "Here is..." or "I'll now write...".`

export function extractAfterMarker(text: string): string {
  const idx = text.indexOf(OUTPUT_MARKER)
  if (idx === -1) return text.trim()
  return text.slice(idx + OUTPUT_MARKER.length).trim()
}

// Splits marker-delimited paragraph output ("<<<PARAGRAPH:key>>>...") into a
// map of key -> text. Unlike parseResearchSections, the marker vocabulary
// isn't a fixed 4-name set — it's whatever variable-slot keys the admin
// template defines — so there's no lenient heading-alias fallback here. On a
// parse miss, callers fall back to a cheap reformat pass (mirrors
// meeting-prep's research repairFormat).
export function parseParagraphMarkers(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  const markerRe = /<<<PARAGRAPH:([a-zA-Z0-9_-]+)>>>/g
  const matches = [...text.matchAll(markerRe)]
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1]
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    result[key] = text.slice(start, end).trim()
  }
  return result
}

export function paragraphMarkersComplete(parsed: Record<string, string>, keys: string[]): boolean {
  return keys.every((k) => Boolean(parsed[k]?.trim()))
}

// Pulls a leading "Subject: ..." line off a generated email so the UI can
// show it as its own field instead of duplicating it inline with the body —
// the email is otherwise just a condensed version of the letter (see
// EMAIL_SYSTEM in the email route), so the subject line is the one part
// worth calling out on its own.
export function splitEmailSubject(emailText: string): { subject: string | null; body: string } {
  const lines = emailText.split('\n')
  const match = (lines[0] || '').trim().match(/^subject:\s*(.+)$/i)
  if (!match) return { subject: null, body: emailText.trim() }
  return { subject: match[1].trim(), body: lines.slice(1).join('\n').trim() }
}

// Splits a personalize response's "<<<SECTION:LETTER>>>...<<<SECTION:EMAIL>>>..."
// output into its two parts. Same technique as parseResearchSections, scoped
// to exactly the two fixed keys this call always produces.
export function parseLetterEmailSections(text: string): { letter: string; email: string } {
  const markerRe = /<<<SECTION:(LETTER|EMAIL)>>>/g
  const matches = [...text.matchAll(markerRe)]
  const result: { letter: string; email: string } = { letter: '', email: '' }
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1] as 'LETTER' | 'EMAIL'
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const body = text.slice(start, end).trim()
    if (key === 'LETTER') result.letter = body
    else result.email = body
  }
  return result
}

// Splits the research call's "<<<HOOK>>>...<<<BULLETS>>>..." output into a
// proposed hook string and a list of bullet strings (one per "- " line).
export function parseResearchOutput(text: string): { hook: string; bullets: string[] } {
  const markerRe = /<<<(HOOK|BULLETS)>>>/g
  const matches = [...text.matchAll(markerRe)]
  const sections: Record<string, string> = {}
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1]
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    sections[key] = text.slice(start, end).trim()
  }
  const bullets = (sections.BULLETS || '')
    .split('\n')
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
  return { hook: (sections.HOOK || '').trim(), bullets }
}

export function researchOutputComplete(parsed: { hook: string; bullets: string[] }): boolean {
  return Boolean(parsed.hook) && parsed.bullets.length > 0
}

// Heuristic backstop for US-055's "one-page constraint" — not real pagination
// (same spirit as the final-document module's regex heading-check backstop),
// just a total-word-count ceiling a one-page business letter shouldn't exceed.
export const ONE_PAGE_WORD_LIMIT = 450

export function wordCount(text: string): number {
  const trimmed = (text || '').trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// Renders a template's structure into one prompt block: fixed slots shown
// verbatim as immovable scaffolding context, variable slots shown as
// instructions + word budget for the model to fill in against a
// <<<PARAGRAPH:key>>> marker.
export function templateStructureToPrompt(structure: InterviewLetterParagraphSlot[]): string {
  return structure
    .map((slot) => {
      if (slot.type === 'fixed') {
        return `[${slot.key}] FIXED (${slot.label}) — reproduce verbatim, do not generate:\n${slot.content || ''}`
      }
      return `[${slot.key}] VARIABLE (${slot.label}) — word budget: ${slot.wordBudget || 80} words\nInstructions: ${slot.instructions || ''}`
    })
    .join('\n\n')
}

export function variableSlotKeys(structure: InterviewLetterParagraphSlot[]): string[] {
  return structure.filter((s) => s.type === 'variable').map((s) => s.key)
}

// Joins a project's locked paragraphs, in template order, into the plain-text
// master letter body (US-055's snapshot).
export function paragraphsToLetterText(paragraphs: { content: string }[]): string {
  return paragraphs.map((p) => p.content).join('\n\n')
}
