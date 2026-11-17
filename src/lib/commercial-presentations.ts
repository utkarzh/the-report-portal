import type {
  AgencyMasterContent,
  CommercialPresentation,
  MasterContentSection,
  MediaMasterContent,
  PresentationBlockConfig,
  PresentationBlockType,
  PresentationExternalFact,
  PresentationIssue,
  PresentationManualField,
  PresentationMasterRef,
  PresentationSegment,
  PresentationSegmentKind,
  PresentationStructure,
  Project,
  RenderedBlock,
  RenderedSegment,
  WhyNowConfig,
} from '@/types'

// ────────────────────────────────────────────────────────────────────────────
// Commercial Presentation Generator — shared, pure logic (server + client).
//
// The core rule of the brief ("the AI should not rewrite information TRC
// already knows and has approved") is enforced STRUCTURALLY here: every block
// except "Why [Country] Now" is rendered by code from admin-controlled
// templates; Claude is only ever asked to write the [WHY NOW] text, so it
// cannot alter master content it never sees.
// ────────────────────────────────────────────────────────────────────────────

export const MODULE_PATH = '/commercial/presentations'
export const ADMIN_PATH = '/commercial/admin/presentations'
export const API_PATH = '/api/commercial-presentations'

export const CLAUDE_MODEL = 'claude-sonnet-4-6'

// MVP is English. The architecture keys every piece of master content by
// language, so Spanish/French later are new master rows, not a redesign.
export const DEFAULT_LANGUAGE = 'en'
export const PRESENTATION_LANGUAGES: { value: string; label: string; available: boolean }[] = [
  { value: 'en', label: 'English', available: true },
  { value: 'es', label: 'Spanish (coming later)', available: false },
  { value: 'fr', label: 'French (coming later)', available: false },
]

export const SEGMENT_KIND_LABELS: Record<PresentationSegmentKind, string> = {
  say: 'SAY',
  action: 'ACTION',
  note: 'NOTE',
}

export const BLOCK_TYPE_OPTIONS: { value: PresentationBlockType; label: string; help: string }[] = [
  { value: 'template', label: 'Fixed template', help: 'Locked methodology or master content written here, with variables.' },
  { value: 'agency', label: 'Agency details', help: "Uses the agency profile's details when it has any, otherwise the segments here." },
  { value: 'media', label: 'Media master content', help: "Replaced entirely by the selected publication's approved script." },
  { value: 'why_now', label: 'Why [Country] Now (AI)', help: 'Segments here wrap the AI text; put [WHY NOW] where it goes.' },
]

// The brief's project types, for picking a varied set of reference examples.
export const REFERENCE_PROJECT_TYPES = [
  'Major international event',
  'Bilateral relations',
  'Investment story',
  'Economic reform',
  'Geopolitical development',
  'Strategic industry',
  'Trade agreement',
  'Major investment announcement',
  'No obvious anchor event',
]

// ── Variables ───────────────────────────────────────────────────────────────
// Templates use the brief's own [VARIABLE] syntax. A KNOWN variable with no
// value is "missing" (blocks submission when required, highlighted always).
// An UNKNOWN token such as [NAME] is a live placeholder the salesperson fills
// in out loud, so it's left as written.

export const BUILT_IN_VARIABLES = [
  { key: 'AGENCY', label: 'Agency name' },
  { key: 'MEDIA', label: 'Media name' },
  { key: 'COUNTRY', label: 'Project country' },
  { key: 'MEDIA MARKET', label: "Media Market (from the media's profile)" },
  { key: 'ANCHOR EVENT', label: 'Anchor event (optional, from the project)' },
  { key: 'RELEVANT DATE', label: 'Relevant date (optional)' },
  { key: 'WHY NOW', label: 'The selected Why [Country] Now text' },
] as const

const TOKEN_RE = /\[([A-Z][A-Z0-9 &/-]*[A-Z0-9])\]/g

export function normalizeVarKey(key: string): string {
  return key.trim().toUpperCase().replace(/\s+/g, ' ')
}

export function tokensIn(text: string): string[] {
  return Array.from(text.matchAll(TOKEN_RE), (m) => normalizeVarKey(m[1]))
}

export function fillVariables(text: string, vars: Record<string, string>, known: ReadonlySet<string>): { text: string; missing: string[] } {
  const missing: string[] = []
  const out = text.replace(TOKEN_RE, (whole, raw: string) => {
    const key = normalizeVarKey(raw)
    const value = vars[key]
    if (value && value.trim()) return value.trim()
    if (known.has(key)) missing.push(key)
    return whole
  })
  return { text: out, missing }
}

export interface PresentationVariablesInput {
  project: Pick<Project, 'agency_name' | 'media_name' | 'country' | 'anchor_event' | 'anchor_date'>
  mediaMarket: string
  manualInputs: Record<string, string>
  relevantDate?: string
  whyNowText: string
}

export function buildVariables(input: PresentationVariablesInput): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.manualInputs || {})) vars[normalizeVarKey(k)] = v || ''
  return {
    ...vars,
    AGENCY: input.project.agency_name,
    MEDIA: input.project.media_name,
    COUNTRY: input.project.country,
    'MEDIA MARKET': input.mediaMarket,
    'ANCHOR EVENT': input.project.anchor_event,
    'RELEVANT DATE': input.relevantDate || input.project.anchor_date || '',
    'WHY NOW': input.whyNowText,
  }
}

export function knownVariableKeys(structure: PresentationStructure): Set<string> {
  return new Set<string>([
    ...BUILT_IN_VARIABLES.map((v) => v.key),
    ...structure.manualFields.map((f) => normalizeVarKey(f.key)),
  ])
}

function segmentVisible(seg: PresentationSegment, vars: Record<string, string>): boolean {
  const has = (k?: string) => Boolean(k && (vars[normalizeVarKey(k)] || '').trim())
  if (seg.showIf && !has(seg.showIf)) return false
  if (seg.hideIf && has(seg.hideIf)) return false
  return true
}

export function renderSegments(
  segments: PresentationSegment[],
  vars: Record<string, string>,
  known: ReadonlySet<string>,
  source: RenderedSegment['source'],
): RenderedSegment[] {
  return segments.filter((s) => segmentVisible(s, vars)).map((s) => {
    const body = fillVariables(s.text, vars, known)
    const heading = s.heading ? fillVariables(s.heading, vars, known) : null
    return {
      kind: s.kind,
      ...(heading ? { heading: heading.text } : {}),
      text: body.text,
      // The [WHY NOW] text comes from Claude; everything else is master.
      source: source === 'structure' && tokensIn(s.text).includes('WHY NOW') ? 'ai' : source,
      missing: Array.from(new Set([...body.missing, ...(heading?.missing || [])])),
    }
  })
}

export interface RenderInput {
  structure: PresentationStructure
  agencyContent: AgencyMasterContent | null
  mediaContent: MediaMasterContent | null
  /** [MEDIA MARKET]: the media script's Media Market, else its Media Library country. */
  mediaMarket: string
  project: Pick<Project, 'agency_name' | 'media_name' | 'country' | 'anchor_event' | 'anchor_date'>
  manualInputs: Record<string, string>
  relevantDate?: string
  whyNowText: string
}

export interface RenderResult {
  blocks: RenderedBlock[]
  issues: PresentationIssue[]
}

export function renderPresentation(input: RenderInput): RenderResult {
  const vars = buildVariables({
    project: input.project,
    mediaMarket: input.mediaMarket,
    manualInputs: input.manualInputs,
    relevantDate: input.relevantDate,
    whyNowText: input.whyNowText,
  })
  const known = knownVariableKeys(input.structure)
  const issues: PresentationIssue[] = []

  const blocks: RenderedBlock[] = input.structure.blocks.map((block, i) => {
    let segments: RenderedSegment[]
    if (block.type === 'media') {
      const media = input.mediaContent?.sections || []
      if (!sectionsHaveContent(media)) {
        issues.push({
          level: 'error',
          message: `${input.project.media_name || 'This media'} has no approved presentation script yet. Ask an admin to add it under Presentations → Admin → Media scripts.`,
        })
      }
      segments = renderSections(media, vars, known, 'media')
    } else if (block.type === 'agency' && agencyHasContent(input.agencyContent)) {
      segments = renderSections(input.agencyContent!.sections, vars, known, 'agency')
    } else {
      segments = renderSegments(block.segments, vars, known, 'structure')
    }
    return {
      key: block.key,
      number: i + 1,
      title: fillVariables(block.title, vars, known).text,
      type: block.type,
      typeLabel: block.typeLabel,
      segments,
    }
  })

  if (!input.whyNowText.trim() && input.structure.blocks.some((b) => b.type === 'why_now')) {
    issues.push({ level: 'error', message: 'Generate the Why [Country] Now block and select the version to use.' })
  }
  for (const f of input.structure.manualFields) {
    if (f.required && !(input.manualInputs[f.key] || '').trim()) {
      issues.push({ level: 'error', message: `Fill in “${f.label}”.` })
    }
  }
  if (!input.mediaMarket.trim()) {
    issues.push({
      level: 'warning',
      message: `${input.project.media_name || 'This media'} has no Media Market, so [MEDIA MARKET] stays unfilled. Ask an admin to set it on the media's script, or its country in the Media Library.`,
    })
  }
  const stillMissing = new Set(blocks.flatMap((b) => b.segments.flatMap((s) => s.missing)))
  for (const key of ['MEDIA MARKET', 'WHY NOW', ...input.structure.manualFields.filter((f) => f.required).map((f) => f.key)]) {
    stillMissing.delete(normalizeVarKey(key))
  }
  if (stillMissing.size > 0) {
    issues.push({ level: 'warning', message: `Some placeholders have no value yet: ${Array.from(stillMissing).map((k) => `[${k}]`).join(', ')}.` })
  }
  return { blocks, issues }
}

export function hasBlockingIssues(issues: PresentationIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}

// ── Master content validation (admin saves) ─────────────────────────────────

const SEGMENT_KINDS: PresentationSegmentKind[] = ['say', 'action', 'note']
const BLOCK_TYPES: PresentationBlockType[] = ['template', 'agency', 'media', 'why_now']

function str(v: unknown, max = 20_000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

export function newSegmentId(): string {
  return `s${Math.random().toString(36).slice(2, 10)}`
}

export function sanitizeSegments(raw: unknown): PresentationSegment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r): PresentationSegment | null => {
      const o = (r ?? {}) as Record<string, unknown>
      const kind = SEGMENT_KINDS.includes(o.kind as PresentationSegmentKind) ? (o.kind as PresentationSegmentKind) : 'say'
      const text = str(o.text).trim()
      if (!text) return null
      const seg: PresentationSegment = { id: str(o.id, 40) || newSegmentId(), kind, text }
      const heading = str(o.heading, 200).trim()
      const showIf = normalizeVarKey(str(o.showIf, 60))
      const hideIf = normalizeVarKey(str(o.hideIf, 60))
      if (heading) seg.heading = heading
      if (showIf) seg.showIf = showIf
      if (hideIf) seg.hideIf = hideIf
      return seg
    })
    .filter((s): s is PresentationSegment => s !== null)
}

function sanitizeManualFields(raw: unknown): PresentationManualField[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PresentationManualField[] = []
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>
    const key = normalizeVarKey(str(o.key, 60))
    if (!key || seen.has(key) || BUILT_IN_VARIABLES.some((v) => v.key === key)) continue
    seen.add(key)
    out.push({
      key,
      label: str(o.label, 120).trim() || key,
      placeholder: str(o.placeholder, 200).trim(),
      required: o.required === true,
      multiline: o.multiline === true,
    })
  }
  return out
}

export function validateStructure(raw: unknown): { ok: true; value: PresentationStructure } | { ok: false; error: string } {
  const o = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.blocks) || o.blocks.length === 0) return { ok: false, error: 'The structure needs at least one block.' }
  const keys = new Set<string>()
  const blocks: PresentationBlockConfig[] = []
  for (const b of o.blocks) {
    const bo = (b ?? {}) as Record<string, unknown>
    const title = str(bo.title, 200).trim()
    if (!title) return { ok: false, error: 'Every block needs a title.' }
    const type = BLOCK_TYPES.includes(bo.type as PresentationBlockType) ? (bo.type as PresentationBlockType) : 'template'
    let key = str(bo.key, 60).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') || title.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    while (keys.has(key)) key = `${key}_2`
    keys.add(key)
    blocks.push({ key, title, type, typeLabel: str(bo.typeLabel, 120).trim(), segments: sanitizeSegments(bo.segments) })
  }
  if (blocks.filter((b) => b.type === 'why_now').length > 1) return { ok: false, error: 'Only one block can be the AI-generated Why [Country] Now block.' }
  if (blocks.filter((b) => b.type === 'media').length > 1) return { ok: false, error: 'Only one block can be the media master content block.' }
  const whyNow = blocks.find((b) => b.type === 'why_now')
  if (whyNow && !whyNow.segments.some((s) => tokensIn(s.text).includes('WHY NOW'))) {
    return { ok: false, error: 'The Why [Country] Now block needs a segment containing [WHY NOW], where the AI text goes.' }
  }
  return { ok: true, value: { blocks, manualFields: sanitizeManualFields(o.manualFields) } }
}

// Agency and media master content = titled sections of SAY / ACTION / NOTE.
// Content saved before sections existed ({ segments }) loads as one untitled
// section, so nothing has to be migrated.
export function sanitizeSections(raw: unknown): MasterContentSection[] {
  const o = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.sections) && Array.isArray(o.segments)) {
    const segments = sanitizeSegments(o.segments)
    return segments.length ? [{ id: newSegmentId(), title: '', segments }] : []
  }
  return (Array.isArray(o.sections) ? o.sections : [])
    .map((r) => {
      const s = (r ?? {}) as Record<string, unknown>
      return { id: str(s.id, 40) || newSegmentId(), title: str(s.title, 200).trim(), segments: sanitizeSegments(s.segments) }
    })
    .filter((s) => s.title || s.segments.length)
}

export function sectionsHaveContent(sections: MasterContentSection[] | null | undefined): boolean {
  return Boolean(sections?.some((s) => s.segments.length > 0))
}

export function sectionLineCount(sections: MasterContentSection[] | null | undefined): number {
  return (sections || []).reduce((n, s) => n + s.segments.length, 0)
}

// All sections, in their saved order; each title becomes a sub-heading over
// the section's first visible line (a fully hidden section disappears).
export function renderSections(
  sections: MasterContentSection[],
  vars: Record<string, string>,
  known: ReadonlySet<string>,
  source: RenderedSegment['source'],
): RenderedSegment[] {
  return sections.flatMap((section) => {
    const rendered = renderSegments(section.segments, vars, known, source)
    if (rendered.length && section.title) rendered[0] = { ...rendered[0], section: fillVariables(section.title, vars, known).text }
    return rendered
  })
}

export function validateAgencyContent(raw: unknown): AgencyMasterContent {
  return { sections: sanitizeSections(raw) }
}

export function agencyHasContent(c: AgencyMasterContent | null | undefined): boolean {
  return sectionsHaveContent(c?.sections)
}

export function validateMediaContent(raw: unknown): MediaMasterContent {
  const o = (raw ?? {}) as Record<string, unknown>
  return { mediaMarket: str(o.mediaMarket, 120).trim(), sections: sanitizeSections(raw) }
}

// The Media Market defaults to the publication's country in the central Media
// Library (the media script can override it). It's dropped into spoken lines
// ("positive exposure in [MEDIA MARKET]"), so names English says with "the"
// get it: "United States" → "the United States", "UK" → "the UK".
const COUNTRIES_WITH_THE = new Set([
  'united states', 'united states of america', 'us', 'usa', 'united kingdom', 'uk', 'united arab emirates', 'uae',
  'netherlands', 'philippines', 'czech republic', 'dominican republic', 'bahamas', 'gambia', 'maldives',
  'seychelles', 'comoros', 'marshall islands', 'solomon islands', 'central african republic', 'democratic republic of the congo',
  'republic of the congo', 'vatican', 'vatican city',
])

export function mediaMarketFromCountry(country: string | null | undefined): string {
  const c = (country || '').trim()
  if (!c || /^the\s/i.test(c)) return c
  return COUNTRIES_WITH_THE.has(c.toLowerCase().replace(/\./g, '')) ? `the ${c}` : c
}

export const DEFAULT_WHY_NOW_CONFIG: Omit<WhyNowConfig, 'prompt'> = {
  minWords: 100,
  maxWords: 170,
  wordsPerMinute: 150,
  bannedPhrases: ['at the crossroads', 'dynamic economy', 'exciting opportunities', 'rapidly evolving landscape'],
  maxWebSearches: 5,
  referenceExamplesLimit: 4,
  briefChars: 40_000,
  letterChars: 12_000,
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export function validateWhyNowConfig(raw: unknown): WhyNowConfig {
  const o = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_WHY_NOW_CONFIG
  const minWords = int(o.minWords, d.minWords, 20, 600)
  return {
    prompt: str(o.prompt, 60_000),
    minWords,
    maxWords: Math.max(minWords + 10, int(o.maxWords, d.maxWords, 30, 800)),
    wordsPerMinute: int(o.wordsPerMinute, d.wordsPerMinute, 80, 250),
    bannedPhrases: Array.isArray(o.bannedPhrases)
      ? Array.from(new Set(o.bannedPhrases.map((p) => str(p, 120).trim()).filter(Boolean)))
      : d.bannedPhrases,
    maxWebSearches: int(o.maxWebSearches, d.maxWebSearches, 1, 15),
    referenceExamplesLimit: int(o.referenceExamplesLimit, d.referenceExamplesLimit, 0, 20),
    briefChars: int(o.briefChars, d.briefChars, 2_000, 150_000),
    letterChars: int(o.letterChars, d.letterChars, 1_000, 60_000),
  }
}

// ── Why [Country] Now ───────────────────────────────────────────────────────

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) || []).length
}

export function spokenSeconds(text: string, wordsPerMinute: number): number {
  return Math.round((wordCount(text) / Math.max(1, wordsPerMinute)) * 60)
}

export const SPOKEN_MARKER = '<<<SPOKEN_VERSION>>>'
export const FACTS_MARKER = '<<<NEW_EXTERNAL_FACTS>>>'

// Fixed, placed LAST in the system prompt so it overrides anything in the
// admin text about format (same pattern as the document module's
// OUTPUT_CONTRACT). Marker-delimited, not JSON: the web-search tool and a
// strict JSON schema don't mix well, and literal markers are a contract the
// model can't talk its way around.
export function whyNowOutputContract(config: WhyNowConfig, researchAllowed: boolean): string {
  return `OUTPUT CONTRACT (follow exactly; it overrides any other formatting instruction)
Write two sections, each introduced by its marker on its own line, and nothing else — no greeting, no preamble, no notes:

${SPOKEN_MARKER}
One polished spoken version, ready to be delivered verbally: ${config.minWords}–${config.maxWords} words (about ${Math.round((config.minWords / config.wordsPerMinute) * 60)}–${Math.round((config.maxWords / config.wordsPerMinute) * 60)} seconds at ${config.wordsPerMinute} words per minute). Plain paragraphs of spoken English only: no headings, no bullets, no quotation marks around the whole text, no source mentions.

${FACTS_MARKER}
${researchAllowed
    ? 'List ONLY material facts you took from fresh external (web) research that are NOT in the supplied project sources, one per line, as: - <fact> | <source URL>. If there are none, write exactly: None.'
    : 'No web research is available for this run, so write exactly: None. Every fact in the spoken version must come from the supplied project sources.'}`
}

export interface ParsedWhyNow {
  spoken: string
  facts: PresentationExternalFact[]
  complete: boolean
}

export function parseWhyNowOutput(text: string): ParsedWhyNow {
  const s = text.indexOf(SPOKEN_MARKER)
  const f = text.indexOf(FACTS_MARKER)
  if (s === -1) return { spoken: '', facts: [], complete: false }
  const spokenRaw = text.slice(s + SPOKEN_MARKER.length, f > s ? f : undefined)
  const factsRaw = f > s ? text.slice(f + FACTS_MARKER.length) : ''
  const spoken = spokenRaw
    .replace(/^\s*["“]|["”]\s*$/g, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
  const facts: PresentationExternalFact[] = factsRaw
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim())
    .filter((l) => l && !/^none\.?$/i.test(l))
    .map((l) => {
      const [fact, ...rest] = l.split('|')
      return { fact: fact.trim(), source: rest.join('|').trim() }
    })
    .filter((x) => x.fact)
  return { spoken, facts, complete: Boolean(spoken) }
}

// Deterministic, zero-cost backstop checks on the model's own guidance.
export function whyNowProblems(spoken: string, config: WhyNowConfig): string[] {
  const problems: string[] = []
  const words = wordCount(spoken)
  if (words < config.minWords) problems.push(`It is ${words} words; it must be at least ${config.minWords}.`)
  if (words > config.maxWords) problems.push(`It is ${words} words; it must be at most ${config.maxWords}.`)
  const lower = spoken.toLowerCase()
  const banned = config.bannedPhrases.filter((p) => lower.includes(p.toLowerCase()))
  if (banned.length) problems.push(`It uses banned phrases: ${banned.map((p) => `“${p}”`).join(', ')}.`)
  if (/^\s*(#|[-*•]\s)/m.test(spoken)) problems.push('It contains headings or bullet points; it must be plain spoken paragraphs.')
  if (/\bwill be published\b/i.test(spoken)) problems.push('It says “will be published”; use “we aim to publish” / “we intend to coincide with” unless publication is confirmed.')
  return problems
}

// "[COUNTRY]" etc. inside the admin prompt text.
export function applyPromptVariables(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(TOKEN_RE, (whole, raw: string) => {
    const v = vars[normalizeVarKey(raw)]
    return v && v.trim() ? v.trim() : whole
  })
}

// ── Status, refs, labels ────────────────────────────────────────────────────

export function presentationStatus(p: Pick<CommercialPresentation, 'status' | 'approved_snapshot_id'>): {
  label: string
  tone: 'emerald' | 'amber' | 'red' | 'sky' | 'stone'
} {
  if (p.status === 'approved') return { label: 'Approved', tone: 'emerald' }
  if (p.status === 'submitted') return { label: 'Awaiting approval', tone: 'sky' }
  if (p.approved_snapshot_id) return { label: 'Revision in progress', tone: 'amber' }
  return { label: 'Draft', tone: 'stone' }
}

export const EVENT_LABELS: Record<string, string> = {
  created: 'Presentation created',
  why_now_generated: 'Why Now generated',
  why_now_alternative: 'Alternative Why Now generated',
  why_now_edited: 'Why Now edited',
  why_now_selected: 'Why Now version selected',
  submitted: 'Submitted for approval',
  returned: 'Returned for changes',
  approved: 'Approved and locked',
  reopened: 'Reopened for revision',
  master_updated: 'Reopened to use new master content',
  brief_attached: 'Editorial Brief attached',
  brief_generated: 'Editorial Brief generated',
  letter_attached: 'Interview Request Letter attached',
  letter_generated: 'Interview Request Letter generated',
}

// True when any master content the snapshot used has a newer version now.
// The Why Now prompt is deliberately excluded: a prompt edit doesn't change
// the approved text, so it isn't "new master content" for the presentation.
export function masterRefsOutdated(snapshotRefs: PresentationMasterRef[], currentRefs: PresentationMasterRef[]): boolean {
  const current = new Map(currentRefs.map((r) => [`${r.kind}:${r.refId ?? ''}`, r]))
  for (const r of snapshotRefs) {
    if (r.kind === 'why_now_prompt') continue
    const now = current.get(`${r.kind}:${r.refId ?? ''}`)
    if (!now || now.id !== r.id || now.versionLabel !== r.versionLabel) return true
  }
  // A media/agency script added since approval is also new master content.
  for (const r of currentRefs) {
    if (r.kind === 'why_now_prompt') continue
    if (!snapshotRefs.some((s) => s.kind === r.kind && (s.refId ?? '') === (r.refId ?? ''))) return true
  }
  return false
}

export function defaultProjectName(p: { country: string; mediaName: string; edition: string }): string {
  return [p.country.trim(), p.mediaName.trim()].filter(Boolean).join(' × ') + (p.edition.trim() ? ` ${p.edition.trim()}` : '')
}

export function presentationFileBase(p: Pick<Project, 'country' | 'media_name' | 'edition'>): string {
  const parts = ['Commercial Presentation', p.country, p.media_name, p.edition].map((x) => (x || '').trim()).filter(Boolean)
  return parts.join(' – ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
}
