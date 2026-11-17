import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessCommercialPresentations, canApproveCommercialPresentations } from '@/lib/access'
import { missingOptionalColumn } from '@/lib/schema-compat'
import { isMissingTable } from '@/lib/knowledge/schema-compat'
import { cleanBriefText, paragraphsToLetterText } from '@/lib/interview-letters'
import {
  DEFAULT_LANGUAGE,
  renderPresentation,
  validateAgencyContent,
  mediaMarketFromCountry,
  validateMediaContent,
  validateStructure,
  validateWhyNowConfig,
  type RenderResult,
} from '@/lib/commercial-presentations'
import type {
  AgencyMasterContent,
  CommercialPresentation,
  CommercialPresentationStatus,
  MediaMasterContent,
  PresentationMasterContentRow,
  PresentationMasterKind,
  PresentationMasterRef,
  PresentationStructure,
  PresentationWhyNowVersion,
  Project,
  UserRole,
  WhyNowConfig,
} from '@/types'

// Server-side helpers for the Commercial Presentation Generator. Every API
// route and page goes through these, so access, loading and rendering are
// defined exactly once.

export const NOT_INSTALLED_MESSAGE =
  'Commercial Presentations isn’t set up on this database yet — run supabase/migrations/046_commercial_presentations.sql.'

export interface PresentationActor {
  id: string
  role: UserRole
  fullName: string | null
  canApprove: boolean
  tokensUsed: number
  tokenLimit: number | null
}

// Auth + active account + module access. API routes are excluded from the
// middleware, so every route calls this.
export async function requirePresentationActor(): Promise<
  { actor: PresentationActor; response?: undefined } | { actor: null; response: NextResponse }
> {
  const auth = await getApiUser()
  if (!auth.user) return { actor: null, response: auth.response }
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, full_name, tokens_used, token_limit, can_access_commercial_presentations, can_approve_commercial_presentations')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (missingOptionalColumn(error, ['can_access_commercial_presentations', 'can_approve_commercial_presentations'])) {
    return { actor: null, response: NextResponse.json({ error: NOT_INSTALLED_MESSAGE }, { status: 503 }) }
  }
  if (!data || data.status !== 'active') {
    return { actor: null, response: NextResponse.json({ error: 'Account inactive' }, { status: 403 }) }
  }
  if (!canAccessCommercialPresentations(data)) {
    return { actor: null, response: NextResponse.json({ error: 'You don’t have access to Commercial Presentations' }, { status: 403 }) }
  }
  return {
    actor: {
      id: data.id,
      role: data.role,
      fullName: data.full_name,
      canApprove: canApproveCommercialPresentations(data),
      tokensUsed: data.tokens_used ?? 0,
      tokenLimit: data.token_limit,
    },
  }
}

export function requireAdminActor(actor: PresentationActor): NextResponse | null {
  return actor.role === 'admin' ? null : NextResponse.json({ error: 'Admins only' }, { status: 403 })
}

export function hasTokenBudget(actor: PresentationActor, reserve: number): boolean {
  return actor.role === 'admin' || actor.tokenLimit == null || actor.tokenLimit - actor.tokensUsed >= reserve
}

// ── Master content ──────────────────────────────────────────────────────────

export async function loadMasterRow(
  kind: PresentationMasterKind,
  refId: string | null,
  language: string = DEFAULT_LANGUAGE,
): Promise<PresentationMasterContentRow | null> {
  const query = (lang: string) => {
    let q = supabaseAdmin.from('presentation_master_content').select('*').eq('kind', kind).eq('language', lang)
    q = refId ? q.eq('ref_id', refId) : q.is('ref_id', null)
    return q.maybeSingle()
  }
  const { data } = await query(language)
  if (data || language === DEFAULT_LANGUAGE) return (data as PresentationMasterContentRow | null) ?? null
  // A language without its own master content falls back to English.
  const { data: fallback } = await query(DEFAULT_LANGUAGE)
  return (fallback as PresentationMasterContentRow | null) ?? null
}

export async function loadStructure(language?: string): Promise<{ row: PresentationMasterContentRow | null; structure: PresentationStructure }> {
  const row = await loadMasterRow('structure', null, language)
  const parsed = validateStructure(row?.content)
  return { row, structure: parsed.ok ? parsed.value : { blocks: [], manualFields: [] } }
}

export async function loadWhyNowConfig(language?: string): Promise<{ row: PresentationMasterContentRow | null; config: WhyNowConfig }> {
  const row = await loadMasterRow('why_now_prompt', null, language)
  return { row, config: validateWhyNowConfig(row?.content) }
}

async function loadAgency(agencyId: string | null, language?: string): Promise<{ row: PresentationMasterContentRow | null; content: AgencyMasterContent | null }> {
  if (!agencyId) return { row: null, content: null }
  const row = await loadMasterRow('agency', agencyId, language)
  return { row, content: row ? validateAgencyContent(row.content) : null }
}

async function loadMedia(mediaId: string | null, language?: string): Promise<{ row: PresentationMasterContentRow | null; content: MediaMasterContent | null }> {
  if (!mediaId) return { row: null, content: null }
  const row = await loadMasterRow('media', mediaId, language)
  return { row, content: row ? validateMediaContent(row.content) : null }
}

function refOf(row: PresentationMasterContentRow | null): PresentationMasterRef | null {
  return row ? { kind: row.kind, id: row.id, refId: row.ref_id, versionLabel: row.version_label } : null
}

// ── The assembled presentation ──────────────────────────────────────────────

export interface PresentationBundle {
  presentation: CommercialPresentation
  project: Project
  structure: PresentationStructure
  mediaContent: MediaMasterContent | null
  /** [MEDIA MARKET]: the media script's Media Market, else its Media Library country. */
  mediaMarket: string
  agencyContent: AgencyMasterContent | null
  selectedVersion: PresentationWhyNowVersion | null
  rendered: RenderResult
  masterRefs: PresentationMasterRef[]
}

export async function loadPresentationBundle(presentationId: string): Promise<PresentationBundle | null> {
  const { data: presentation, error } = await supabaseAdmin
    .from('commercial_presentations')
    .select('*')
    .eq('id', presentationId)
    .maybeSingle()
  if (error && isMissingTable(error)) throw new Error(NOT_INSTALLED_MESSAGE)
  if (!presentation) return null
  const { data: project } = await supabaseAdmin.from('projects').select('*').eq('id', presentation.project_id).maybeSingle()
  if (!project) return null

  const language = presentation.language || DEFAULT_LANGUAGE
  const [structure, agency, media, selected, mediaEntry] = await Promise.all([
    loadStructure(language),
    loadAgency(project.agency_id, language),
    loadMedia(project.media_id, language),
    presentation.selected_why_now_id
      ? supabaseAdmin.from('presentation_why_now_versions').select('*').eq('id', presentation.selected_why_now_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.media_id
      ? supabaseAdmin.from('media_library').select('country').eq('id', project.media_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const mediaMarket =
    media.content?.mediaMarket || mediaMarketFromCountry((mediaEntry.data as { country?: string | null } | null)?.country)
  const selectedVersion = (selected.data as PresentationWhyNowVersion | null) ?? null
  const whyNowInputs = (presentation.why_now_inputs || {}) as CommercialPresentation['why_now_inputs']

  const rendered = renderPresentation({
    structure: structure.structure,
    agencyContent: agency.content,
    mediaContent: media.content,
    mediaMarket,
    project,
    manualInputs: (presentation.manual_inputs || {}) as Record<string, string>,
    relevantDate: whyNowInputs.relevantDate,
    whyNowText: selectedVersion?.spoken_text || '',
  })
  if (!structure.row) {
    rendered.issues.unshift({ level: 'error', message: 'No presentation structure is configured. Ask an admin to set it up.' })
  }

  const masterRefs = [refOf(structure.row), refOf(agency.row), refOf(media.row)].filter(
    (r): r is PresentationMasterRef => r !== null,
  )

  return {
    presentation: presentation as CommercialPresentation,
    project: project as Project,
    structure: structure.structure,
    mediaContent: media.content,
    mediaMarket,
    agencyContent: agency.content,
    selectedVersion,
    rendered,
    masterRefs,
  }
}

// Who may change what, by status (brief §19–20):
//   draft     — anyone with module access (the team iterates freely)
//   submitted — Manager/Admin only ("Edit and Approve")
//   approved  — nobody; reopen first
export function editBlockedReason(actor: PresentationActor, p: Pick<CommercialPresentation, 'status'>): string | null {
  if (p.status === 'approved') return 'This presentation is approved and locked. Reopen it for revision first.'
  if (p.status === 'submitted' && !actor.canApprove) return 'This presentation is awaiting approval. A Manager can edit it or return it for changes.'
  return null
}

export async function recordPresentationEvent(presentationId: string, eventType: string, actorId: string | null, comment?: string | null) {
  const { error } = await supabaseAdmin
    .from('presentation_events')
    .insert({ presentation_id: presentationId, event_type: eventType, actor_id: actorId, comment: comment || null })
  if (error) console.error('Failed to record presentation event:', error.message)
}

export const STATUS_CHANGED_MESSAGE =
  'This presentation was submitted, approved, returned or reopened while you were working on it. Reload to see its current state.'

// Every write to a presentation goes through here, guarded on the status the
// caller read (compare-and-set). A request that loaded a draft can't write
// into it after someone submitted or approved it, and two Managers approving
// at once can't both win: the second one's update matches no row. `conflict`
// is true when that happened; nothing was written.
export async function touchPresentation(
  presentationId: string,
  actorId: string,
  patch: Record<string, unknown>,
  expectedStatus: CommercialPresentationStatus,
): Promise<{ error: { message: string } | null; conflict: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('commercial_presentations')
    .update({ ...patch, updated_by: actorId })
    .eq('id', presentationId)
    .eq('status', expectedStatus)
    .select('id')
  if (error) return { error, conflict: false }
  return { error: null, conflict: !data || data.length === 0 }
}

/** 409 for a write that lost the status race (see touchPresentation). */
export function statusChangedResponse() {
  return NextResponse.json({ error: STATUS_CHANGED_MESSAGE }, { status: 409 })
}

// Adds one Why Now run's usage to the presentation's running totals in one
// statement (migration 048), so two runs finishing together can't drop one.
// Before 048 runs it falls back to read-then-write; the usage_events ledger,
// which analytics reads, is exact either way.
export async function addPresentationUsage(
  presentationId: string,
  u: { tokens: number; webSearches: number; cost: number },
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('commercial_presentation_add_usage', {
    p_presentation: presentationId,
    p_tokens: Math.round(u.tokens) || 0,
    p_web_searches: u.webSearches || 0,
    p_cost: u.cost || 0,
  })
  if (!error) return
  const { data: row } = await supabaseAdmin
    .from('commercial_presentations')
    .select('tokens_total, web_searches, cost_usd')
    .eq('id', presentationId)
    .maybeSingle()
  if (!row) return
  await supabaseAdmin
    .from('commercial_presentations')
    .update({
      tokens_total: (row.tokens_total || 0) + u.tokens,
      web_searches: (row.web_searches || 0) + u.webSearches,
      cost_usd: Number(row.cost_usd || 0) + u.cost,
    })
    .eq('id', presentationId)
}

// ── Project intelligence (fetch side of "fetch or generate") ────────────────

export interface ProjectBrief {
  id: string
  title: string
  status: string
  text: string
}

export async function loadProjectBrief(project: Pick<Project, 'editorial_brief_id'>): Promise<ProjectBrief | null> {
  if (!project.editorial_brief_id) return null
  const { data } = await supabaseAdmin
    .from('document_sessions')
    .select('id, title, status, output')
    .eq('id', project.editorial_brief_id)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, title: data.title, status: data.status, text: cleanBriefText(data.output) }
}

export interface ProjectLetter {
  id: string
  stage: string
  text: string
  /** True once the letter was final-approved in the Interview Letters module. */
  reviewed: boolean
}

export async function loadProjectLetter(project: Pick<Project, 'interview_letter_id'>): Promise<ProjectLetter | null> {
  if (!project.interview_letter_id) return null
  const { data } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, stage, master_letter, paragraphs')
    .eq('id', project.interview_letter_id)
    .maybeSingle()
  if (!data) return null
  const approved = typeof data.master_letter === 'string' && data.master_letter.trim().length > 0
  const draft = Array.isArray(data.paragraphs) ? paragraphsToLetterText(data.paragraphs as { content: string }[]) : ''
  return { id: data.id, stage: data.stage, text: approved ? data.master_letter : draft, reviewed: approved }
}

export async function profileNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))))
  const map = new Map<string, string>()
  if (unique.length === 0) return map
  const { data } = await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', unique)
  for (const p of data || []) map.set(p.id, p.full_name || p.email || 'Unknown user')
  return map
}

// Server components build the actor from the middleware-injected headers
// (getProfileFromHeaders) — no extra DB call; middleware already enforced
// module access for /commercial/presentations.
export function actorFromHeaderProfile(p: {
  id: string
  role: UserRole
  full_name: string | null
  tokens_used: number
  token_limit: number
  can_approve_commercial_presentations: boolean
}): PresentationActor {
  return {
    id: p.id,
    role: p.role,
    fullName: p.full_name,
    canApprove: p.role === 'admin' || p.can_approve_commercial_presentations,
    tokensUsed: p.tokens_used,
    tokenLimit: p.role === 'admin' ? null : p.token_limit,
  }
}
