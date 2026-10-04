import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { runGeminiResearch } from '@/lib/copywriting-gemini'

interface Params {
  params: { id: string }
}

// POST — "Start Research": sends one or more writer-flagged
// claims/gaps to Gemini, which checks them against approved outside sources
// (FLOW-05) and logs each finding to the Research Ledger as 'pending'.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()
  const { data: project } = await supabaseAdmin.from('copywriting_projects').select('id, user_id, draft_name, editorial_objective').eq('id', params.id).single()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const claims: string[] = Array.isArray(body.claims) ? body.claims.filter((c: unknown) => typeof c === 'string' && c.trim()) : []
  if (!claims.length) return NextResponse.json({ error: 'At least one claim is required' }, { status: 400 })

  const { data: promptRow } = await supabaseAdmin.from('copywriting_prompt').select('prompt_text').eq('prompt_key', 'research').maybeSingle()

  try {
    const findings = await runGeminiResearch({
      promptText: promptRow?.prompt_text || '',
      claims,
      articleContext: `${project.draft_name} — ${project.editorial_objective || ''}`,
    })

    const rows = findings.map((f) => ({
      project_id: project.id,
      claim: f.claim,
      source_url: f.sourceUrl,
      publication_date: f.publicationDate,
      period_covered: f.periodCovered,
      confidence: f.confidence,
      caveats: f.caveats,
      status: 'pending' as const,
    }))

    const { data: inserted, error } = await supabaseAdmin.from('copywriting_research_entries').insert(rows).select('*')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await supabaseAdmin.from('copywriting_project_events').insert({
      project_id: project.id,
      event_type: 'research_run',
      summary: `Research run on ${claims.length} claim${claims.length === 1 ? '' : 's'} — ${findings.length} finding${findings.length === 1 ? '' : 's'} returned.`,
      // The exact claims sent, so the draft screen can stop offering flagged
      // gaps that have already been researched.
      payload: { claims },
    })

    return NextResponse.json({ entries: inserted || [] }, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Research failed' }, { status: 500 })
  }
}
