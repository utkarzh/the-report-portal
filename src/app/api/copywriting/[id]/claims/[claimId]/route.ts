import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { runGeminiResearch } from '@/lib/copywriting-gemini'
import { refreshResearchPlacements } from '@/lib/copywriting-ledger'

interface Params {
  params: { id: string; claimId: string }
}

// PATCH — { action: 'approve' | 'reject' | 'regenerate', feedback? }
// Every finding must be individually approved, rejected, or regenerated with
// feedback before it can be used in the plan/article (Comment 1, FLOW-05).
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  const { data: project } = await supabaseAdmin.from('copywriting_projects').select('id, user_id, draft_name, editorial_objective, draft_text').eq('id', params.id).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: entry } = await supabaseAdmin
    .from('copywriting_research_entries')
    .select('*')
    .eq('id', params.claimId)
    .eq('project_id', params.id)
    .single()
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const action = body.action as string

  // checked_at means "last verified against sources" — only a (re)research
  // run sets it, never an approve/reject decision.
  if (action === 'approve') {
    const { error } = await supabaseAdmin
      .from('copywriting_research_entries')
      .update({ status: 'approved' })
      .eq('id', entry.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // An approval can put this finding into an existing draft's ledger positions.
    await refreshResearchPlacements(project.id, project.draft_text)
    const { data } = await supabaseAdmin.from('copywriting_research_entries').select('*').eq('id', entry.id).single()
    return NextResponse.json({ entry: data })
  }

  if (action === 'reject') {
    const { data, error } = await supabaseAdmin
      .from('copywriting_research_entries')
      .update({ status: 'rejected', placement: null })
      .eq('id', entry.id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ entry: data })
  }

  if (action === 'regenerate') {
    const feedback = (body.feedback as string) || ''
    const { data: promptRow } = await supabaseAdmin.from('copywriting_prompt').select('prompt_text').eq('prompt_key', 'research').maybeSingle()
    try {
      const claim = feedback ? `${entry.claim} (writer feedback on the previous attempt: ${feedback})` : entry.claim
      const findings = await runGeminiResearch({
        promptText: promptRow?.prompt_text || '',
        claims: [claim],
        articleContext: `${project.draft_name} — ${project.editorial_objective || ''}`,
      })
      const f = findings[0]
      if (!f) return NextResponse.json({ error: 'Gemini returned nothing usable — try again.' }, { status: 502 })

      const { data, error } = await supabaseAdmin
        .from('copywriting_research_entries')
        .update({
          claim: entry.claim,
          source_url: f.sourceUrl,
          publication_date: f.publicationDate,
          period_covered: f.periodCovered,
          confidence: f.confidence,
          caveats: f.caveats,
          status: 'pending',
          placement: null,
          checked_at: new Date().toISOString(),
        })
        .eq('id', entry.id)
        .select('*')
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ entry: data })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Regeneration failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
