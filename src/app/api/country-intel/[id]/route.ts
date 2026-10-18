import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireCiAdmin } from '@/lib/country-intel/auth'
import { startProject, summarize } from '@/lib/country-intel/engine'
import type { CiProject } from '@/lib/country-intel/types'

// GET    /api/country-intel/[id] — project + progress summary
// PATCH  /api/country-intel/[id] — { action: 'start' | 'pause' | 'resume', budgetUsd? }
// DELETE /api/country-intel/[id] — removes the project, its companies and tasks
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const { data: project } = await supabaseAdmin.from('ci_projects').select('*').eq('id', params.id).maybeSingle()
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ project, summary: await summarize(params.id) })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const body = await request.json().catch(() => ({}))
  const { data } = await supabaseAdmin.from('ci_projects').select('*').eq('id', params.id).maybeSingle()
  const project = data as CiProject | null
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const budget = Number(body.budgetUsd)
  if (Number.isFinite(budget) && budget > 0) {
    if (budget < Number(project.spent_usd)) return NextResponse.json({ error: `The budget can’t be below what has already been spent ($${Number(project.spent_usd).toFixed(2)}).` }, { status: 400 })
    await supabaseAdmin.from('ci_projects').update({ budget_usd: budget, updated_at: new Date().toISOString() }).eq('id', project.id)
  }

  if (body.action === 'start') {
    if (project.status !== 'draft') return NextResponse.json({ error: 'This research has already started.' }, { status: 409 })
    await startProject(project)
  } else if (body.action === 'pause') {
    if (project.status === 'running') await supabaseAdmin.from('ci_projects').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', project.id)
  } else if (body.action === 'resume') {
    if (project.status === 'paused' || project.status === 'failed') {
      if (String(project.error || '').startsWith('BUDGET:') && !(Number.isFinite(budget) && budget > Number(project.spent_usd) + 0.05)) {
        return NextResponse.json({ error: 'The budget has been reached — raise it to continue.' }, { status: 409 })
      }
      await supabaseAdmin.from('ci_projects').update({ status: 'running', error: null, updated_at: new Date().toISOString() }).eq('id', project.id)
    }
  }
  const { data: fresh } = await supabaseAdmin.from('ci_projects').select('*').eq('id', params.id).single()
  return NextResponse.json({ project: fresh, summary: await summarize(params.id) })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const { error } = await supabaseAdmin.from('ci_projects').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
