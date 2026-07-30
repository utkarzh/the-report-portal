import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getDocConfig, isDocType } from '@/lib/documents'
import { validateDocumentInputs } from '@/lib/claude/validate-inputs'

// POST /api/documents — creates a document_sessions row (Business Case /
// Editorial Brief). Mirrors /api/sessions: this route does NOT call Claude; it
// only records the row and returns its id. The destination page opens the
// streaming generation so a live SSE connection is never abandoned by a nav.
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, can_access_business_cases, can_access_editorial_briefs')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  const body = await request.json()
  const { docType, projectCountry, mediaPartner, mediaCountry, additionalContext } = body as {
    docType?: string
    projectCountry?: string
    mediaPartner?: string
    mediaCountry?: string
    additionalContext?: string
  }

  if (!isDocType(docType)) {
    return NextResponse.json({ error: 'Invalid docType' }, { status: 400 })
  }
  const config = getDocConfig(docType)

  // Per-module access (admins bypass).
  const hasAccess = profile.role === 'admin' || profile[config.permissionKey]
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Headroom gate — never let a generation slip the budget (per-type reserve).
  if (
    profile.role === 'user' &&
    profile.token_limit != null &&
    profile.token_limit - profile.tokens_used < config.tokenReserve
  ) {
    return NextResponse.json(
      { error: 'Not enough token budget remaining for another generation' },
      { status: 402 },
    )
  }

  // Sanity gate — reject placeholder/off-topic submissions BEFORE creating the
  // session, so nonsense inputs can't spend a full document's worth of Claude
  // budget. Costs a fraction of a cent; fails open if the check is unavailable.
  const verdict = await validateDocumentInputs(
    docType,
    { projectCountry, mediaPartner, mediaCountry, additionalContext },
    user.id,
  )
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 422 })
  }

  // Snapshot the admin prompt at creation time (regenerations reuse the snapshot).
  const { data: promptRow } = await supabaseAdmin
    .from('document_prompt')
    .select('prompt_text')
    .eq('doc_type', docType)
    .maybeSingle()

  const pc = (projectCountry || '').trim()
  const title = pc ? `${config.label} — ${pc}` : config.label

  const { data: created, error } = await supabaseAdmin
    .from('document_sessions')
    .insert({
      user_id: user.id,
      doc_type: docType,
      title,
      project_country: (projectCountry || '').trim() || null,
      media_partner: (mediaPartner || '').trim() || null,
      media_country: (mediaCountry || '').trim() || null,
      additional_context: (additionalContext || '').trim() || null,
      prompt_snapshot: promptRow?.prompt_text || '',
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !created) {
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }

  return NextResponse.json({ id: created.id }, { status: 201 })
}
