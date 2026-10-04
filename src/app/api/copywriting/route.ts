import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessCopywritingTool } from '@/lib/access'
import { orIlikeFilter } from '@/lib/search'
import { MAX_IMAGE_COUNT } from '@/lib/copywriting'

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

  const { draftName, publicationId, articleTypeId, editorialObjective, sectionStructure, targetLength, quotesRequired, imageCount } = body

  if (!draftName || typeof draftName !== 'string' || !draftName.trim()) {
    return NextResponse.json({ error: 'Draft name is required' }, { status: 400 })
  }
  if (!publicationId || !articleTypeId) {
    return NextResponse.json({ error: 'Publication and article type are required' }, { status: 400 })
  }

  const [{ data: publication }, { data: articleType }] = await Promise.all([
    supabaseAdmin.from('copywriting_publications').select('id, name').eq('id', publicationId).maybeSingle(),
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
      section_structure: sectionStructure || '',
      target_length: typeof targetLength === 'number' ? targetLength : targetLength ? Number(targetLength) : null,
      quotes_required: typeof quotesRequired === 'number' ? quotesRequired : quotesRequired ? Number(quotesRequired) : null,
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
