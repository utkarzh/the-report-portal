import { supabaseAdmin } from '@/lib/supabase/admin'
import { masterRefsOutdated, sectionsHaveContent, spokenSeconds, wordCount } from '@/lib/commercial-presentations'
import {
  editBlockedReason,
  loadWhyNowConfig,
  profileNames,
  type PresentationActor,
  type PresentationBundle,
} from '@/lib/commercial-presentations-server'
import type {
  Agency,
  PresentationEvent,
  PresentationIssue,
  PresentationManualField,
  PresentationSnapshot,
  PresentationWhyNowVersion,
  Project,
  CommercialPresentation,
  RenderedBlock,
} from '@/types'

// Everything the workspace needs, in one shape — used by the page's initial
// render and by GET /api/commercial-presentations/[id] for refreshes, so the
// two can never disagree.

export interface WhyNowVersionView extends PresentationWhyNowVersion {
  createdByName: string | null
  words: number
  seconds: number
}

export interface SnapshotSummary {
  id: string
  versionNumber: number
  approvedAt: string
  approvedByName: string | null
  editedOnApproval: boolean
}

export interface WorkspaceState {
  presentation: CommercialPresentation
  project: Project
  agency: Pick<Agency, 'id' | 'name' | 'code' | 'active'> | null
  manualFields: PresentationManualField[]
  mediaMarket: string
  /** The publication's own country from the Media Library (for brief generation). */
  mediaCountry: string
  hasMediaScript: boolean
  /** The live draft rendering (always the current master content). */
  rendered: RenderedBlock[]
  issues: PresentationIssue[]
  /** The approved snapshot in use, if any (what exports when approved). */
  approvedSnapshot: PresentationSnapshot | null
  snapshots: SnapshotSummary[]
  masterOutdated: boolean
  versions: WhyNowVersionView[]
  events: (PresentationEvent & { actorName: string | null })[]
  sources: {
    brief: { id: string; title: string; status: string; source: Project['editorial_brief_source'] } | null
    letter: { id: string; stage: string; reviewed: boolean; source: Project['interview_letter_source'] } | null
  }
  examplesCount: number
  whyNowRules: { minWords: number; maxWords: number; wordsPerMinute: number; maxWebSearches: number }
  permissions: { canEdit: boolean; editBlockedReason: string | null; canApprove: boolean; isAdmin: boolean }
}

export async function buildWorkspaceState(bundle: PresentationBundle, actor: PresentationActor): Promise<WorkspaceState> {
  const { presentation, project } = bundle

  const [versionsRes, snapshotsRes, eventsRes, agencyRes, briefRes, letterRes, examplesRes, whyNow, mediaRes] = await Promise.all([
    supabaseAdmin.from('presentation_why_now_versions').select('*').eq('presentation_id', presentation.id).order('created_at', { ascending: false }),
    supabaseAdmin
      .from('presentation_snapshots')
      .select('id, version_number, approved_at, approved_by, edited_on_approval')
      .eq('presentation_id', presentation.id)
      .order('version_number', { ascending: false }),
    supabaseAdmin.from('presentation_events').select('*').eq('presentation_id', presentation.id).order('created_at', { ascending: false }).limit(60),
    project.agency_id
      ? supabaseAdmin.from('agencies').select('id, name, code, active').eq('id', project.agency_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.editorial_brief_id
      ? supabaseAdmin.from('document_sessions').select('id, title, status').eq('id', project.editorial_brief_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.interview_letter_id
      ? supabaseAdmin.from('interview_letter_projects').select('id, stage, master_letter').eq('id', project.interview_letter_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('presentation_reference_examples').select('id', { count: 'exact', head: true }).eq('active', true),
    loadWhyNowConfig(presentation.language),
    project.media_id
      ? supabaseAdmin.from('media_library').select('country').eq('id', project.media_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  let approvedSnapshot: PresentationSnapshot | null = null
  if (presentation.approved_snapshot_id) {
    const { data } = await supabaseAdmin.from('presentation_snapshots').select('*').eq('id', presentation.approved_snapshot_id).maybeSingle()
    approvedSnapshot = (data as PresentationSnapshot | null) ?? null
  }

  const versions = (versionsRes.data || []) as PresentationWhyNowVersion[]
  const snapshots = (snapshotsRes.data || []) as { id: string; version_number: number; approved_at: string; approved_by: string | null; edited_on_approval: boolean }[]
  const events = (eventsRes.data || []) as PresentationEvent[]
  const names = await profileNames([...versions.map((v) => v.created_by), ...snapshots.map((s) => s.approved_by), ...events.map((e) => e.actor_id)])
  const config = whyNow.config
  const blocked = editBlockedReason(actor, presentation)

  const brief = briefRes.data as { id: string; title: string; status: string } | null
  const letter = letterRes.data as { id: string; stage: string; master_letter: string | null } | null

  return {
    presentation,
    project,
    agency: (agencyRes.data as WorkspaceState['agency']) ?? null,
    manualFields: bundle.structure.manualFields,
    mediaMarket: bundle.mediaMarket,
    mediaCountry: ((mediaRes.data as { country?: string | null } | null)?.country || '').trim(),
    hasMediaScript: sectionsHaveContent(bundle.mediaContent?.sections),
    rendered: bundle.rendered.blocks,
    issues: bundle.rendered.issues,
    approvedSnapshot,
    snapshots: snapshots.map((s) => ({
      id: s.id,
      versionNumber: s.version_number,
      approvedAt: s.approved_at,
      approvedByName: s.approved_by ? names.get(s.approved_by) || null : null,
      editedOnApproval: s.edited_on_approval,
    })),
    masterOutdated: approvedSnapshot ? masterRefsOutdated(approvedSnapshot.master_refs || [], bundle.masterRefs) : false,
    versions: versions.map((v) => ({
      ...v,
      createdByName: v.created_by ? names.get(v.created_by) || null : null,
      words: wordCount(v.spoken_text),
      seconds: spokenSeconds(v.spoken_text, config.wordsPerMinute),
    })),
    events: events.map((e) => ({ ...e, actorName: e.actor_id ? names.get(e.actor_id) || null : null })),
    sources: {
      brief: brief ? { ...brief, source: project.editorial_brief_source } : null,
      letter: letter
        ? { id: letter.id, stage: letter.stage, reviewed: Boolean(letter.master_letter?.trim()), source: project.interview_letter_source }
        : null,
    },
    examplesCount: examplesRes.count ?? 0,
    whyNowRules: {
      minWords: config.minWords,
      maxWords: config.maxWords,
      wordsPerMinute: config.wordsPerMinute,
      maxWebSearches: config.maxWebSearches,
    },
    permissions: {
      canEdit: blocked === null,
      editBlockedReason: blocked,
      canApprove: actor.canApprove,
      isAdmin: actor.role === 'admin',
    },
  }
}
