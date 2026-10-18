import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireCiAdmin, isMissingCiTable, CI_NOT_INSTALLED } from '@/lib/country-intel/auth'
import { estimateRun } from '@/lib/country-intel/depth'
import { normName, parseClientList } from '@/lib/country-intel/parse'
import type { CiDepth, CiSector } from '@/lib/country-intel/types'

// POST /api/country-intel — creates a research project (status "draft") and
// the client-named companies. No Gemini call happens here: research starts
// when the workspace sends { action: 'start' } to /api/country-intel/[id].
export async function POST(request: NextRequest) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const title = String(body.title || '').trim()
  const country = String(body.country || '').trim()
  const brief = String(body.brief || '').trim()
  const depth = (['quick', 'standard', 'deep'].includes(body.depth) ? body.depth : 'standard') as CiDepth
  const targetCount = Math.round(Number(body.targetCount))
  const minRevenueUsd = Math.round(Number(body.minRevenueUsd ?? 60_000_000))
  const sectors: CiSector[] = (Array.isArray(body.sectors) ? body.sectors : [])
    .map((s: { name?: string; scope?: string }) => ({ name: String(s?.name || '').trim(), scope: String(s?.scope || '').trim() }))
    .filter((s: CiSector) => s.name)
    .slice(0, 15)

  if (!title || !country) return NextResponse.json({ error: 'Title and country are required.' }, { status: 400 })
  if (!sectors.length) return NextResponse.json({ error: 'Add at least one sector.' }, { status: 400 })
  if (!Number.isFinite(targetCount) || targetCount < 5 || targetCount > 500) return NextResponse.json({ error: 'Target companies must be between 5 and 500.' }, { status: 400 })
  if (!Number.isFinite(minRevenueUsd) || minRevenueUsd < 0) return NextResponse.json({ error: 'Invalid revenue threshold.' }, { status: 400 })

  const clients = parseClientList(String(body.clientList || ''), sectors.map((s) => s.name)).slice(0, 400)
  const includeContacts = body.includeContacts !== false
  const includeContext = body.includeContext !== false
  const est = estimateRun({ depth, targetCount, sectorCount: sectors.length, clientCount: clients.length, includeContacts, includeContext })
  const requestedBudget = Number(body.budgetUsd)
  const budgetUsd = Number.isFinite(requestedBudget) && requestedBudget > 0 ? Math.max(requestedBudget, 0.3) : est.budgetUsd

  const { data: project, error } = await supabaseAdmin.from('ci_projects').insert({
    user_id: auth.userId, title, country, brief, sectors, target_count: targetCount, depth,
    min_revenue_usd: minRevenueUsd, local_hq_only: body.localHqOnly !== false,
    include_contacts: includeContacts, include_context: includeContext, budget_usd: budgetUsd,
  }).select('id').single()
  if (error) {
    if (isMissingCiTable(error)) return NextResponse.json({ error: CI_NOT_INSTALLED }, { status: 503 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const seen = new Set<string>()
  const rows = clients.filter((c) => { const k = normName(c.name); if (!k || seen.has(k)) return false; seen.add(k); return true })
    .map((c) => ({ project_id: project.id, name: c.name, norm_name: normName(c.name), origin: 'client', sector: c.sector, round: 1 }))
  if (rows.length) {
    const { error: cErr } = await supabaseAdmin.from('ci_companies').insert(rows)
    if (cErr) return NextResponse.json({ error: `Project created, but the client list could not be saved: ${cErr.message}` }, { status: 500 })
  }
  return NextResponse.json({ id: project.id, clients: rows.length, estimate: est, budgetUsd })
}
