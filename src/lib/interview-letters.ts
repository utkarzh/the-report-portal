import type {
  InterviewLetterBriefOption,
  InterviewLetterCompany,
  InterviewLetterParagraphSlot,
  InterviewLetterVariant,
} from '@/types'

export const INTERVIEW_LETTER_COMPANIES: { value: InterviewLetterCompany; label: string }[] = [
  { value: 'TRC', label: 'The Report Company (TRC)' },
  { value: 'GFDI', label: 'Global Foreign Direct Investment (GFDI)' },
]

export function isInterviewLetterCompany(v: unknown): v is InterviewLetterCompany {
  return v === 'TRC' || v === 'GFDI'
}

export const INTERVIEW_LETTER_VARIANTS: { value: InterviewLetterVariant; label: string; description: string }[] = [
  {
    value: 'anchor',
    label: 'With an anchor',
    description: 'The report is tied to an event or publication occasion. The anchor is introduced in the second paragraph, with how it connects to the report.',
  },
  {
    value: 'no_anchor',
    label: 'Without an anchor',
    description: 'No event or occasion. The letter opens with the report’s purpose and mentions publication timing later, where relevant.',
  },
]

export function isInterviewLetterVariant(v: unknown): v is InterviewLetterVariant {
  return v === 'anchor' || v === 'no_anchor'
}

export function variantLabel(v: InterviewLetterVariant | 'any' | null | undefined): string {
  if (v === 'any') return 'Either version'
  return INTERVIEW_LETTER_VARIANTS.find((x) => x.value === v)?.label || 'Without an anchor'
}

// ------------------------------------------------------------
// Editorial Brief matching (setup form suggestion + server auto-match)
// ------------------------------------------------------------
function normText(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const hasWords = (hay: string, needle: string) => Boolean(needle) && ` ${hay} `.includes(` ${needle} `)

// 2 = same country, 1 = one names the other ("Armenia and Albania" ↔ "Albania",
// or the country only appears in the brief's title), 0 = unrelated.
export function briefMatchScore(brief: Pick<InterviewLetterBriefOption, 'project_country' | 'title'>, country: string): number {
  const want = normText(country)
  if (!want) return 0
  const have = normText(brief.project_country)
  if (have && have === want) return 2
  if (have && (hasWords(have, want) || hasWords(want, have))) return 1
  return hasWords(normText(brief.title), want) ? 1 : 0
}

// Matching briefs, best first: closest country match, then most recent.
export function matchBriefs<T extends InterviewLetterBriefOption>(briefs: T[], country: string): T[] {
  return briefs
    .map((b) => ({ b, score: briefMatchScore(b, country) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || y.b.created_at.localeCompare(x.b.created_at))
    .map((x) => x.b)
}

// A brief's stored output can still carry the document engine's completion
// marker on very old rows; the letter never needs it.
export function cleanBriefText(output: string | null | undefined): string {
  const text = output || ''
  const idx = text.indexOf('<<<DOCUMENT_COMPLETE>>>')
  return (idx === -1 ? text : text.slice(0, idx)).trim()
}

// Cuts at a paragraph boundary so the excerpt never ends mid-sentence.
export function briefExcerpt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.lastIndexOf('\n\n', maxChars)
  return `${text.slice(0, cut > maxChars * 0.6 ? cut : maxChars).trim()}\n\n[… rest of the Editorial Brief omitted for length …]`
}

// ------------------------------------------------------------
// Media library — the approved description is copied in by code, never by
// the model, so it reaches the letter word for word.
// ------------------------------------------------------------
export const MEDIA_DESCRIPTION_TOKEN = '[Approved Media Partner Description]'

// Also accepts the shorter spellings an admin might type into a template.
const mediaTokenRe = () => /\[\s*(?:approved\s+)?media(?:\s+partner)?\s+description\s*\]|\{\{\s*media_description\s*\}\}/gi

export function hasMediaToken(text: string | null | undefined): boolean {
  return mediaTokenRe().test(text || '')
}

export function templateUsesMediaToken(structure: InterviewLetterParagraphSlot[]): boolean {
  return structure.some((s) => hasMediaToken(s.content) || hasMediaToken(s.instructions))
}

// Swaps the placeholder for the approved description. The wording is never
// touched; only a doubled mark is avoided when the description ends in a full
// stop and the template's sentence carries on with its own punctuation
// ("…, [token], reaching …"). With no description on file the placeholder and
// its leading comma are dropped, so a stray bracket never reaches the letter.
export function applyMediaDescription(text: string, description: string | null | undefined): string {
  if (!hasMediaToken(text)) return text
  const desc = (description || '').trim()
  if (!desc) {
    return text
      .replace(new RegExp(`,\\s*(?:${mediaTokenRe().source})(?=\\s*[,.;:])`, 'gi'), '')
      .replace(new RegExp(`\\s*(?:${mediaTokenRe().source})\\s*\\.?`, 'gi'), ' ')
      .replace(/ {2,}/g, ' ')
      .replace(/ +([,.;:])/g, '$1')
      .trim()
  }
  return text.replace(mediaTokenRe(), (_m, offset: number, whole: string) => {
    const next = whole.slice(offset + _m.length).match(/^\s*([,.;:])/)
    return next && /[.;:,]$/.test(desc) ? desc.replace(/[.;:,]+$/, '') : desc
  })
}

// The reverse, for calls that rewrite an existing paragraph or letter
// (paragraph regenerate, personalize): the description goes back to the
// placeholder before the model sees it and is re-applied afterwards, so a
// rewrite can't paraphrase it.
export function tokenizeMediaDescription(text: string, description: string | null | undefined): string {
  const desc = (description || '').trim()
  if (!desc) return text
  const bare = desc.replace(/[.;:,]+$/, '')
  return text.split(desc).join(MEDIA_DESCRIPTION_TOKEN).split(bare).join(MEDIA_DESCRIPTION_TOKEN)
}

export function mediaDescriptionInstruction(hasDescription: boolean): string {
  return hasDescription
    ? `--- MEDIA PARTNER DESCRIPTION ---
An approved, word-for-word description of the media partner is on file. Wherever the template asks for the media partner's description, write the placeholder ${MEDIA_DESCRIPTION_TOKEN} exactly as shown and nothing else in its place: the system inserts the approved wording afterwards. Keep the punctuation around it as the template has it. Never describe the publication, its audience or its reach in your own words anywhere else in the letter.`
    : `--- MEDIA PARTNER DESCRIPTION ---
No approved description of this media partner is on file. Where the template asks for ${MEDIA_DESCRIPTION_TOKEN}, leave that part out and adjust the punctuation so the sentence still reads naturally. Never describe the publication, its audience or its reach in your own words, and never invent audience figures.`
}

// ------------------------------------------------------------
// Letter version, research and sample blocks shared by the letter calls
// ------------------------------------------------------------
export function letterVersionBlock(p: { letter_variant?: string | null; anchor?: string | null; publication_timing?: string | null }): string {
  const timing = (p.publication_timing || '').trim()
  if (p.letter_variant === 'anchor') {
    return `--- LETTER VERSION: WITH AN ANCHOR ---
This report is anchored to: ${(p.anchor || '').trim() || '(the anchor confirmed in the hook below)'}
Introduce the anchor in the letter's second paragraph and explain how it connects to the report. Do not open the letter with it and do not repeat it at length elsewhere.${timing ? `\nConfirmed publication timing: ${timing}` : ''}`
  }
  return `--- LETTER VERSION: WITHOUT AN ANCHOR ---
This report has no anchor event or occasion. Open with the report's purpose. Mention publication timing later in the letter, only where the template places it, and only if it is confirmed${timing ? ` (confirmed timing: ${timing})` : ' (none is confirmed, so say nothing specific about timing)'}. Never invent an event, summit or occasion to hang the letter on.`
}

export function researchContextBlock(p: { research?: string[] | null; research_updates?: string[] | null; research_cautions?: string[] | null }): string {
  const list = (items: string[] | null | undefined) => (items || []).map((b) => `- ${b}`).join('\n') || '(none)'
  return `--- RESEARCH CONTEXT (verified facts) ---
${list(p.research)}

--- UPDATES SINCE THE EDITORIAL BRIEF (prefer these over the brief where they differ) ---
${list(p.research_updates)}

--- CAUTIONS (qualify these carefully, or leave them out) ---
${list(p.research_cautions)}`
}

export const INTERVIEW_LETTER_SAMPLES_BUCKET = 'interview-letter-samples'
export const SAMPLE_LETTER_ACCEPT = '.docx,.pdf,.txt,.md'
export const SAMPLE_LETTER_EXT_RE = /\.(docx|pdf|txt|md|markdown)$/i

export interface RankableSample {
  id: string
  title: string
  company: string
  variant: string
  sector: string
  notes: string
  created_at: string
}

const SAMPLE_STOPWORDS = new Set(['and', 'the', 'for', 'report', 'reports', 'sector', 'special', 'letter', 'interview', 'request'])

function sampleTokens(s: string): Set<string> {
  return new Set(normText(s).split(' ').filter((w) => w.length > 2 && !SAMPLE_STOPWORDS.has(w)))
}

// Picks the sample letters most relevant to this project, best first. A
// sample tagged for the other company is never used (its branding and
// signature would leak in); sector overlap weighs most, then company, then
// letter version, then recency.
export function rankSamples<T extends RankableSample>(
  samples: T[],
  ctx: { company: string; variant: string; sector: string; country: string },
  max = 3,
): T[] {
  const want = sampleTokens(ctx.sector)
  const country = sampleTokens(ctx.country)
  return samples
    .filter((s) => s.company === 'any' || s.company === ctx.company)
    .map((s) => {
      const have = sampleTokens(`${s.sector} ${s.title} ${s.notes}`)
      let score = s.company === ctx.company ? 3 : 1
      score += s.variant === ctx.variant ? 2 : s.variant === 'any' ? 1 : 0
      score += [...want].filter((w) => have.has(w)).length * 4
      if ([...country].some((w) => have.has(w))) score += 1
      return { s, score }
    })
    .sort((a, b) => b.score - a.score || b.s.created_at.localeCompare(a.s.created_at))
    .slice(0, max)
    .map((x) => x.s)
}

export const SAMPLE_CHARS_PER_LETTER = 8_000

export function samplesBlock(samples: { title: string; variant: string; sector: string; extracted_text: string }[]): string {
  if (samples.length === 0) return ''
  const body = samples
    .map((s, i) => `[Sample ${i + 1}: ${s.title}${s.sector ? ` · ${s.sector}` : ''} · ${variantLabel(s.variant as InterviewLetterVariant | 'any')}]\n${s.extracted_text.slice(0, SAMPLE_CHARS_PER_LETTER)}`)
    .join('\n\n')
  return `--- SAMPLE LETTERS (style and format references only) ---
These are past letters the editors chose as references for format, tone and how reports of this kind are framed. Use them for style only. The TEMPLATE STRUCTURE and its instructions always win over a sample. Never copy facts, names, figures, dates, countries or publications from a sample.

${body}`
}

// Fills the {{PLACEHOLDER}} tokens admins write into the research prompt
// (e.g. {{PROJECT_COUNTRY}}); unknown tokens are left as written.
export function fillPromptPlaceholders(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (m, key: string) => (key in vars ? vars[key] : m))
}

// Splits "text [label](url) text" for rendering research bullets with links.
export function splitMarkdownLinks(text: string): ({ type: 'text'; value: string } | { type: 'link'; label: string; href: string })[] {
  const out: ({ type: 'text'; value: string } | { type: 'link'; label: string; href: string })[] = []
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    out.push({ type: 'link', label: m[1], href: m[2] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
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
// show it as its own field instead of duplicating it inline with the body.
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

export interface ParsedResearch {
  hook: string
  bullets: string[]
  updates: string[]
  cautions: string[]
}

// Splits the research call's "<<<HOOK>>>...<<<BULLETS>>>..." output into a
// proposed hook string and lists of bullet strings (one per "- " line).
// UPDATES and CAUTIONS are optional: older admin prompts, and research run
// without an Editorial Brief, may not produce them.
export function parseResearchOutput(text: string): ParsedResearch {
  const markerRe = /<<<(HOOK|BULLETS|UPDATES|CAUTIONS)>>>/g
  const matches = [...text.matchAll(markerRe)]
  const sections: Record<string, string> = {}
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1]
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    sections[key] = text.slice(start, end).trim()
  }
  const lines = (key: string) =>
    (sections[key] || '')
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((l) => l && !/^\(?(none|n\/a|nothing (new|to (add|report)))\)?\.?$/i.test(l))
  return { hook: (sections.HOOK || '').trim(), bullets: lines('BULLETS'), updates: lines('UPDATES'), cautions: lines('CAUTIONS') }
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

export interface LetterRecipient {
  name?: string | null
  title?: string | null
  organisation?: string | null
}

// "Name, Title, Company" — comma-only, the same convention as every other
// identity line in the app (client, Oct 2026: "must be a comma everywhere").
export function recipientIdentity(r: LetterRecipient | null | undefined): string {
  return [r?.name, r?.title, r?.organisation].map((s) => (s || '').trim()).filter(Boolean).join(', ')
}

// Download name, shared by the export route (Content-Disposition) and the
// download dialog: "Interview Request Letter – Name, Title, Company". A master
// letter downloaded without recipient details falls back to the project
// country, as before.
export function letterDownloadName(country: string, recipient?: LetterRecipient | null): string {
  const who = recipientIdentity(recipient) || country.trim() || 'Interview Letter'
  return `Interview Request Letter – ${who}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 150)
}

// Joins a project's locked paragraphs, in template order, into the plain-text
// master letter body (US-055's snapshot).
export function paragraphsToLetterText(paragraphs: { content: string }[]): string {
  return paragraphs.map((p) => p.content).join('\n\n')
}
