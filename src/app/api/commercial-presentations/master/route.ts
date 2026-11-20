import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { INITIAL_PROMPT_VERSION, isPromptVersionBump, nextPromptVersion } from '@/lib/prompt-versioning'
import {
  DEFAULT_LANGUAGE,
  validateAgencyContent,
  validateMediaContent,
  validateStructure,
  validateWhyNowConfig,
} from '@/lib/commercial-presentations'
import { requireAdminActor, requirePresentationActor } from '@/lib/commercial-presentations-server'
import { validateStructureImportPrompt } from '@/lib/commercial-presentations-structure-import'
import type { PresentationMasterKind } from '@/types'

const KINDS: PresentationMasterKind[] = ['structure', 'agency', 'media', 'why_now_prompt', 'structure_import_prompt']

function parseTarget(kind: unknown, refId: unknown, language: unknown) {
  if (!KINDS.includes(kind as PresentationMasterKind)) return { error: 'Unknown master content kind' as const }
  const k = kind as PresentationMasterKind
  const needsRef = k === 'agency' || k === 'media'
  const ref = typeof refId === 'string' && refId ? refId : null
  if (needsRef && !ref) return { error: `${k} content needs a refId` as const }
  return { kind: k, refId: needsRef ? ref : null, language: typeof language === 'string' && language ? language : DEFAULT_LANGUAGE }
}

// GET ?kind=&refId=&language= — the current master row (admins only), or null.
export async function GET(request: NextRequest) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const sp = request.nextUrl.searchParams
  const target = parseTarget(sp.get('kind'), sp.get('refId'), sp.get('language'))
  if ('error' in target) return NextResponse.json({ error: target.error }, { status: 400 })
  // Exact-language read for editing (no English fallback here).
  let q = supabaseAdmin.from('presentation_master_content').select('*').eq('kind', target.kind).eq('language', target.language)
  q = target.refId ? q.eq('ref_id', target.refId) : q.is('ref_id', null)
  const { data } = await q.maybeSingle()
  return NextResponse.json({ row: data ?? null })
}

// PUT { kind, refId?, language?, content, bump: 'major' | 'minor' } — save.
// The previous content is snapshotted to presentation_master_versions first,
// so nothing is ever lost and any version can be restored (brief §22). An
// already-approved presentation is never changed by this — it keeps its own
// snapshot and shows "New Master Content Available" instead.
export async function PUT(request: NextRequest) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const target = parseTarget(body.kind, body.refId, body.language)
  if ('error' in target) return NextResponse.json({ error: target.error }, { status: 400 })
  if (!isPromptVersionBump(body.bump)) return NextResponse.json({ error: "bump must be 'major' or 'minor'" }, { status: 400 })

  let content: unknown
  if (target.kind === 'structure') {
    const v = validateStructure(body.content)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    content = v.value
  } else if (target.kind === 'agency') {
    const { data } = await supabaseAdmin.from('agencies').select('id').eq('id', target.refId!).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Agency not found' }, { status: 404 })
    content = validateAgencyContent(body.content)
  } else if (target.kind === 'media') {
    const { data } = await supabaseAdmin.from('media_library').select('id').eq('id', target.refId!).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Media not found in the Media Library' }, { status: 404 })
    content = validateMediaContent(body.content)
  } else if (target.kind === 'structure_import_prompt') {
    const v = validateStructureImportPrompt(body.content)
    if (!v.prompt.trim()) return NextResponse.json({ error: 'The instructions can’t be empty. Use “Reset to default” to go back to the built-in ones.' }, { status: 400 })
    content = v
  } else {
    const cfg = validateWhyNowConfig(body.content)
    if (!cfg.prompt.trim()) return NextResponse.json({ error: 'The prompt can’t be empty.' }, { status: 400 })
    content = cfg
  }

  let q = supabaseAdmin.from('presentation_master_content').select('*').eq('kind', target.kind).eq('language', target.language)
  q = target.refId ? q.eq('ref_id', target.refId) : q.is('ref_id', null)
  const { data: current } = await q.maybeSingle()

  if (!current) {
    const { data: row, error } = await supabaseAdmin
      .from('presentation_master_content')
      .insert({ kind: target.kind, ref_id: target.refId, language: target.language, content, version_label: INITIAL_PROMPT_VERSION, updated_by: actor.id })
      .select('*')
      .single()
    if (error?.code === '23514' && target.kind === 'structure_import_prompt') {
      return NextResponse.json(
        { error: 'Saving these instructions needs a database update: run supabase/migrations/050_presentation_structure_import_prompt.sql. Until then the built-in instructions are used.' },
        { status: 503 },
      )
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ row })
  }

  const { data: history } = await supabaseAdmin.from('presentation_master_versions').select('version_label').eq('content_id', current.id)
  const versionLabel = nextPromptVersion([current.version_label, ...(history || []).map((h) => h.version_label)], body.bump)

  const { error: snapError } = await supabaseAdmin
    .from('presentation_master_versions')
    .insert({ content_id: current.id, content: current.content, version_label: current.version_label, saved_by: current.updated_by })
  if (snapError) return NextResponse.json({ error: `Failed to keep the previous version: ${snapError.message}` }, { status: 500 })

  const { data: row, error } = await supabaseAdmin
    .from('presentation_master_content')
    .update({ content, version_label: versionLabel, updated_by: actor.id, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ row })
}

