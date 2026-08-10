import type { InterviewType, MeetingPrepPromptKey, MeetingPrepResearchSections } from '@/types'

export const INTERVIEW_TYPES: { value: InterviewType; label: string }[] = [
  { value: 'company_ceo', label: 'Company CEO' },
  { value: 'government_official', label: 'Government Official' },
]

export function isInterviewType(v: unknown): v is InterviewType {
  return v === 'company_ceo' || v === 'government_official'
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

export function parseResearchSections(text: string): MeetingPrepResearchSections {
  const result: MeetingPrepResearchSections = {}
  const markerRe = /<<<SECTION:(INTERVIEWEE|ORGANISATION|MOTIVATION_PROFILES|QUOTES_NEWS)>>>/g
  const matches = [...text.matchAll(markerRe)]

  for (let i = 0; i < matches.length; i++) {
    const key = matches[i][1] as (typeof RESEARCH_SECTION_KEYS)[number]
    const start = matches[i].index! + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length
    const body = text.slice(start, end).trim()
    if (key === 'INTERVIEWEE') result.interviewee = body
    else if (key === 'ORGANISATION') result.organisation = body
    else if (key === 'MOTIVATION_PROFILES') result.motivation_profiles = body
    else if (key === 'QUOTES_NEWS') result.quotes_news = body
  }

  return result
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
