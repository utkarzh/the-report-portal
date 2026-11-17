import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireCiAdmin } from '@/lib/country-intel/auth'
import { runStep, summarize } from '@/lib/country-intel/engine'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// POST /api/country-intel/[id]/step — works the project's task queue for up to
// ~4 minutes, then returns progress. The workspace calls it in a loop while the
// page is open; progress lives in the database, so closing the page only
// pauses the work (it picks up from the queue on the next call).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  // Heartbeat at both ends of the step, so the project list can tell a run a
  // page is driving from one whose page was closed (isWaitingForPage()).
  await markPageActive(params.id)
  let failure: string | null = null
  try {
    await runStep(params.id)
  } catch (e) {
    console.error('[country-intel] step failed', e)
    failure = e instanceof Error ? e.message : 'Step failed'
  }
  await markPageActive(params.id)
  if (failure) return NextResponse.json({ error: failure, retryable: true }, { status: 500 })
  const { data: project } = await supabaseAdmin.from('ci_projects').select('*').eq('id', params.id).maybeSingle()
  return NextResponse.json({ project, summary: await summarize(params.id) })
}

// Best-effort: a failed stamp only means the list may say "Paused" a little early.
async function markPageActive(id: string) {
  await supabaseAdmin.from('ci_projects').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'running')
}
