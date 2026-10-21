import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessCopywritingTool } from '@/lib/access'
import { orIlikeFilter } from '@/lib/search'
import {
  MAX_IMAGE_COUNT,
  MAX_ARTICLE_SECTIONS,
  MAX_QUOTES,
} from '@/lib/copywriting'
import type { CopywritingProjectSection } from '@/types'

const PAGE_SIZE = 12

async function requireAccess() {
  const auth = await getApiUser()
  if (!auth.user) return { ...auth, profile: null }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, can_access_copywriting_tool')
    .eq('id', auth.user.id)
    .single()
  if (!profile || profile.status === 'inactive') {
    return { user: null, response: NextResponse.json({ error: 'Account inactive' }, { status: 403 }), profile: null }
  }
  if (!canAccessCopywritingTool(profile)) {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), profile: null }
  }
  return { user: auth.user, response: undefined, profile }
}

// GET — normal users see only their own projects; admins see all (Comment 1,
// ACC-03 / HOME-02). Supports ?search=, ?articleType=, ?publication=,
// ?status=, ?page=.
export async function GET(request: NextRequest) {
  const auth = await requireAccess()
  if (!auth.user) return auth.response

  const sp = request.nextUrl.searchParams
  const search = (sp.get('search') || '').trim()
  const articleType = (sp.get('articleType') || '').trim()
  const publication = (sp.get('publication') || '').trim()
  const status = (sp.get('status') || '').trim()
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = supabaseAdmin
    .from('copywriting_projects')
    .select(
      'id, draft_name, publication_name, article_type_name, stage, plan_status, created_at, updated_at, user_id, final_approved_at, profiles:user_id(full_name, email)',
      { count: 'exact' },
    )

  if (auth.profile!.role !== 'admin') {
    query = query.eq('user_id', auth.user.id)
  }
  if (search) query = query.or(orIlikeFilter(['draft_name'], search))
  if (articleType) query = query.eq('article_type_name', articleType)
  if (publication) query = query.eq('publication_name', publication)
  if (status === 'complete') query = query.eq('stage', 'complete')
  else if (status === 'in_progress') query = query.not('stage', 'in', '("complete","failed")')
  else if (status === 'failed') query = query.eq('stage', 'failed')

  const { data, error, count } = await query.order('updated_at', { ascending: false }).range(from, to)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    projects: data || [],
    totalCount: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  })
}

// POST — create a new project from the Configure form (FLOW-01).
export async function POST(request: NextRequest) {
  const auth = await requireAccess()
  if (!auth.user) return auth.response

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const { draftName, publicationId, articleTypeId, editorialObjective, sections, directQuotes, pullQuotes, imageCount } = body

  if (!draftName || typeof draftName !== 'string' || !draftName.trim()) {
    return NextResponse.json({ error: 'Draft name is required' }, { status: 400 })
  }
  if (!publicationId || !articleTypeId) {
    return NextResponse.json({ error: 'Publication and article type are required' }, { status: 400 })
  }

  const [{ data: publication }, { data: articleType }] = await Promise.all([
    supabaseAdmin.from('media_library').select('id, name').eq('id', publicationId).maybeSingle(),
    supabaseAdmin.from('copywriting_article_types').select('id, name').eq('id', articleTypeId).maybeSingle(),
  ])
  if (!publication) return NextResponse.json({ error: 'Publication not found' }, { status: 400 })
  if (!articleType) return NextResponse.json({ error: 'Article type not found' }, { status: 400 })

  // Optional for every article type: blank → the AI decides from the
  // prompts/guides whether photos are needed; 0 → none; N → exactly N.
  let image_count: number | null = null
  if (imageCount !== undefined && imageCount !== null && imageCount !== '') {
    const n = Number(imageCount)
    if (!Number.isInteger(n) || n < 0 || n > MAX_IMAGE_COUNT) {
      return NextResponse.json({ error: `Number of images must be a whole number from 0 to ${MAX_IMAGE_COUNT}.` }, { status: 400 })
    }
    image_count = n
  }

  // Section structure (required, migration 041). The browser sends which
  // library sections, in order, with a length for each; names are taken from
  // the library, never from the request, and stored as a snapshot.
  if (!Array.isArray(sections) || sections.length === 0) {
    return NextResponse.json({ error: 'Build the section structure: add at least one section.' }, { status: 400 })
  }
  if (sections.length > MAX_ARTICLE_SECTIONS) {
    return NextResponse.json({ error: `An article can have at most ${MAX_ARTICLE_SECTIONS} sections.` }, { status: 400 })
  }
  const ids = Array.from(new Set(sections.map((sec: { sectionId?: unknown }) => String(sec?.sectionId || ''))))
  const { data: library } = await supabaseAdmin.from('copywriting_sections').select('id, name, description').in('id', ids)
  const byId = new Map((library || []).map((l) => [l.id as string, { name: l.name as string, description: (l.description as string) || '' }]))
  const snapshot: CopywritingProjectSection[] = []
  for (const sec of sections as { sectionId?: unknown; target?: unknown; targetChars?: unknown; unit?: unknown }[]) {
    const lib = byId.get(String(sec?.sectionId || ''))
    if (!lib) {
      return NextResponse.json({ error: 'One of the chosen sections no longer exists. Refresh the page and rebuild the structure.' }, { status: 400 })
    }
    // Characters by default; `targetChars` is what the form sent before units existed.
    const unit = sec?.unit === 'words' ? 'words' : 'characters'
    const target = Number(sec?.target ?? sec?.targetChars)
    if (!Number.isInteger(target) || target < 1) {
      return NextResponse.json({ error: `“${lib.name}” needs its length in ${unit} (a whole number above 0).` }, { status: 400 })
    }
    snapshot.push({ key: randomUUID(), section_id: String(sec.sectionId), name: lib.name, description: lib.description, unit, target })
  }
  const quoteCount = (value: unknown, label: string): number | string => {
    const n = Number(value)
    return Number.isInteger(n) && n >= 0 && n <= MAX_QUOTES ? n : `${label} must be a whole number from 0 to ${MAX_QUOTES}.`
  }
  const direct_quotes = quoteCount(directQuotes, 'Direct quotes')
  const pull_quotes = quoteCount(pullQuotes, 'Pull quotes')
  if (typeof direct_quotes === 'string') return NextResponse.json({ error: direct_quotes }, { status: 400 })
  if (typeof pull_quotes === 'string') return NextResponse.json({ error: pull_quotes }, { status: 400 })

  const { data: project, error } = await supabaseAdmin
    .from('copywriting_projects')
    .insert({
      user_id: auth.user.id,
      draft_name: draftName.trim(),
      publication_id: publication.id,
      publication_name: publication.name,
      article_type_id: articleType.id,
      article_type_name: articleType.name,
      editorial_objective: editorialObjective || '',
      sections: snapshot,
      direct_quotes,
      pull_quotes,
      image_count,
      stage: 'upload',
    })
    .select('id')
    .single()

  if (error || !project) return NextResponse.json({ error: error?.message || 'Failed to create project' }, { status: 500 })

  await supabaseAdmin.from('copywriting_project_events').insert({
    project_id: project.id,
    event_type: 'project_created',
    summary: `Project "${draftName.trim()}" configured for ${publication.name} / ${articleType.name}.`,
  })

  return NextResponse.json({ id: project.id }, { status: 201 })
}
