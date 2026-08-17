import type { InterviewType, MeetingPrepPromptKey, MeetingPrepResearchSections } from '@/types'

export const INTERVIEW_TYPES: { value: InterviewType; label: string }[] = [
  { value: 'company_ceo', label: 'Company CEO' },
  { value: 'government_official', label: 'Government Official' },
]

export function isInterviewType(v: unknown): v is InterviewType {
  return v === 'company_ceo' || v === 'government_official'
}

// Appended after the admin-managed prompt on every meeting-prep Claude call
// that has no marker/heading of its own to anchor on (points, planteo, final
// document, and the per-section research regenerate — the main research pass
// already strips anything before its first <<<SECTION>>> marker, which is
// exactly why it never leaks narration into saved output). Placed LAST so it
// overrides whatever the admin prompt says, mirroring the document engine's
// OUTPUT_CONTRACT pattern.
//
// A prose instruction alone ("don't narrate") is a request the model can
// still ignore — and does, in practice (analytical asides, "here is the
// updated draft", justification paragraphs standing in for real content all
// slip through). A literal marker is not a request, it's a parsing contract:
// extractAfterMarker() below mechanically discards everything before it
// regardless of what the model wrote, the same structural trick that already
// makes the marker-based research pass reliable. This never dictates *what*
// content to write — only *where* the real answer starts.
export const OUTPUT_MARKER = '<<<OUTPUT>>>'

export const NO_PREAMBLE_INSTRUCTION = `Before writing anything else, output the literal line ${OUTPUT_MARKER} on its own line, with nothing before it — no greeting, no plan, no explanation. Immediately after that line, write ONLY the requested output itself: no preamble, no meta-commentary about what you're doing, no closing remarks. Never write things like "Here is..." or "I'll now write...".`

// Strips everything up to and including the marker. Falls back to the full
// text untouched if the model didn't include it (rare, but keeps the run
// recoverable instead of failing outright — same tolerant philosophy as
// parseResearchSections' lenient fallback below).
export function extractAfterMarker(text: string): string {
  const idx = text.indexOf(OUTPUT_MARKER)
  if (idx === -1) return text.trim()
  return text.slice(idx + OUTPUT_MARKER.length).trim()
}

export const MEETING_PREP_PROMPT_KEYS: { key: MeetingPrepPromptKey; label: string; description: string }[] = [
  {
    key: 'research',
    label: 'Research',
    description: 'Researches the interviewee and organisation: source rules, recency, editorial orientation, motivation profiling, quotes & news.',
  },
  {
    key: 'presentation_points',
    label: 'Presentation Points',
    description: 'Generates the 3 presentation points from approved research — runs only after the user accepts every research section.',
  },
  {
    key: 'planteo',
    label: 'Planteo Build-Up',
    description: 'Builds the verbal pitch from the approved Planteo Library formula and the 3 approved presentation points.',
  },
  {
    key: 'final_document',
    label: 'Final Document',
    description: 'Assembles the final meeting preparation document in its fixed section order and runs the quality checklist.',
  },
]

export function isMeetingPrepPromptKey(v: unknown): v is MeetingPrepPromptKey {
  return v === 'research' || v === 'presentation_points' || v === 'planteo' || v === 'final_document'
}

// Splits the research prompt's marker-delimited output into the 4 named
// sections. Markers ("<<<SECTION:INTERVIEWEE>>>" etc.) are chosen over asking
// for JSON because the section bodies are long, citation-heavy markdown —
// escaping that safely inside a JSON string from a streaming model is fragile,
// while splitting on a unique literal marker is not.
const RESEARCH_SECTION_KEYS = ['INTERVIEWEE', 'ORGANISATION', 'MOTIVATION_PROFILES', 'QUOTES_NEWS'] as const

type SectionField = 'interviewee' | 'organisation' | 'motivation_profiles' | 'quotes_news'

// Heading aliases the model tends to use when it drops the exact <<<SECTION>>>
// markers (it often falls back to plain markdown headings). Matched leniently so
// parsing succeeds instead of failing the whole run.
// Multi-word aliases only — generic single words ("quotes", "motivations",
// "profile") are avoided because they also occur in body prose and would split
// the text in the wrong place.
const SECTION_ALIASES: { field: SectionField; aliases: string[] }[] = [
  { field: 'interviewee', aliases: ['interviewee', 'the interviewee', 'person profile', 'interviewee profile', 'interviewee & background'] },
  { field: 'organisation', aliases: ['organisation', 'organization', 'the organisation', 'the organization', 'company', 'the company', 'company and organisation', 'company & organisation', 'organisation profile', 'the organisation and company'] },
  { field: 'motivation_profiles', aliases: ['motivation profiles', 'motivation profile', 'commercial motivation profiles', 'ranked motivation profiles', 'motivation profile ranking', 'commercial motivation profile'] },
  { field: 'quotes_news', aliases: ['quotes and news', 'quotes & news', 'quotes news', 'recent quotes and news', 'recent quotes & news', 'quotes and latest news', 'quotes & latest news', 'news and quotes', 'recent news and quotes', 'what they have said recently'] },
]

// Normalise a candidate heading line: strip markers, markdown decorations,
// "Section N:" prefixes and trailing punctuation, lowercase it.
function normalizeHeading(line: string): string {
  return line
    .replace(/<<<\s*section\s*:?/gi, '')
    .replace(/>>>/g, '')
    .replace(/^[#>\s]*/, '')            // leading markdown heading / quote markers
    .replace(/^[-*•]\s*/, '')           // leading bullet
    .replace(/[*_`~]/g, '')             // bold/italic/code
    .replace(/^section\s*\d*\s*[:.\-–)]*\s*/i, '') // "SECTION 1:" / "Section:"
    .replace(/^\d+\s*[.)\-–:]\s*/, '')  // "1. " / "2) "
    .replace(/[:：.\s]+$/, '')          // trailing colon / period / space
    .trim()
    .toLowerCase()
}

function headingField(rawLine: string): SectionField | null {
  const h = normalizeHeading(rawLine)
  if (!h || h.length > 70) return null
  const t = rawLine.trim()
  // A real heading is either decorated (markdown/marker/bullet/number) or ALL
  // CAPS. Undecorated lines only count when they EXACTLY equal a section name,
  // so body prose can't be mistaken for a header.
  const decorated =
    /^(#{1,6}\s|>+\s|[-*•]\s|\d+[.)]\s|\*\*|__|<<<)/.test(t) ||
    (t === t.toUpperCase() && /[A-Za-z]/.test(t))
  for (const { field, aliases } of SECTION_ALIASES) {
    for (const a of aliases) {
      if (h === a) return field
      if (decorated && (h.startsWith(a + ' ') || h.startsWith(a + ':') || h.startsWith(a + ' —') || h.startsWith(a + ' -'))) return field
    }
  }
  return null
}

export function parseResearchSections(text: string): MeetingPrepResearchSections {
  // 1) Preferred: exact markers.
  const strict: MeetingPrepResearchSections = {}
  const markerRe = /<<<SECTION:(INTERVIEWEE|ORGANISATION|MOTIVATION_PROFILES|QUOTES_NEWS)>>>/g
  const matches = [...text.matchAll(markerRe)]
  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1] as (typeof RESEARCH_SECTION_KEYS)[number]
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const body = text.slice(start, end).trim()
    if (key === 'INTERVIEWEE') strict.interviewee = body
    else if (key === 'ORGANISATION') strict.organisation = body
    else if (key === 'MOTIVATION_PROFILES') strict.motivation_profiles = body
    else if (key === 'QUOTES_NEWS') strict.quotes_news = body
  }
  if (researchSectionsComplete(strict)) return strict

  // 2) Fallback: the model used ordinary headings. Split the text on any line
  // that reads as one of the four section headings.
  const lines = text.split('\n')
  const marks: { field: SectionField; line: number }[] = []
  lines.forEach((line, idx) => {
    const field = headingField(line)
    if (field) marks.push({ field, line: idx })
  })

  const lenient: MeetingPrepResearchSections = {}
  for (let i = 0; i < marks.length; i++) {
    const { field, line } = marks[i]
    if (lenient[field]) continue // first occurrence wins
    const nextLine = i + 1 < marks.length ? marks[i + 1].line : lines.length
    const body = lines.slice(line + 1, nextLine).join('\n').trim()
    if (body) lenient[field] = body
  }

  // Prefer whichever pass produced more complete sections; merge to be safe.
  return {
    interviewee: strict.interviewee || lenient.interviewee,
    organisation: strict.organisation || lenient.organisation,
    motivation_profiles: strict.motivation_profiles || lenient.motivation_profiles,
    quotes_news: strict.quotes_news || lenient.quotes_news,
  }
}

export function researchSectionsComplete(s: MeetingPrepResearchSections): boolean {
  return Boolean(s.interviewee?.trim() && s.organisation?.trim() && s.motivation_profiles?.trim() && s.quotes_news?.trim())
}

// Splits "1. ...\n2. ...\n3. ..." into an array of trimmed point strings.
export function parsePoints(text: string): string[] {
  const matches = [...text.matchAll(/^\s*\d+\.\s+([\s\S]*?)(?=^\s*\d+\.\s+|$(?![\s\S]))/gm)]
  const points = matches.map(m => m[1].trim()).filter(Boolean)
  return points.length > 0 ? points : [text.trim()].filter(Boolean)
}

export function researchSectionsToPrompt(sections: MeetingPrepResearchSections): string {
  return `--- INTERVIEWEE RESEARCH ---
${sections.interviewee || '(missing)'}

--- ORGANISATION RESEARCH ---
${sections.organisation || '(missing)'}

--- RANKED COMMERCIAL MOTIVATION PROFILES ---
${sections.motivation_profiles || '(missing)'}

--- RECENT QUOTES & LATEST NEWS ---
${sections.quotes_news || '(missing)'}`
}
