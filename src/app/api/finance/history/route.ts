import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'

// GET /api/finance/history?entityType=expense&entityId=… — one ticket's or
// funding's history (migration 043), for Finance and that project's team.
// GET /api/finance/history?projectId=… — everything on one project, Finance
// only. Newest first. An empty list before migration 043 has run.
export async function GET(request: NextRequest) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth
  const admin = isFinanceAdmin(profile)

  const projectId = request.nextUrl.searchParams.get('projectId')
  const entityType = request.nextUrl.searchParams.get('entityType')
  const entityId = request.nextUrl.searchParams.get('entityId')

  let query = supabaseAdmin.from('finance_audit_log').select('*').order('created_at', { ascending: false }).limit(500)
  if (projectId) {
    if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    query = query.eq('project_id', projectId)
  } else if (entityType && entityId) {
    query = query.eq('entity_type', entityType).eq('entity_id', entityId)
  } else {
    return NextResponse.json({ error: 'projectId, or entityType and entityId, are required.' }, { status: 400 })
  }

  const { data, error } = await query
  if (error) {
    console.error('Reading finance history failed:', error.message)
    return NextResponse.json({ entries: [] })
  }

  // A member only sees history of their own projects (the entries carry the
  // project, so this holds for removed tickets too).
  if (!admin && (data ?? []).length > 0) {
    const { data: memberships } = await supabaseAdmin.from('finance_project_members').select('project_id').eq('user_id', profile.id)
    const mine = new Set((memberships ?? []).map(m => m.project_id))
    return NextResponse.json({ entries: (data ?? []).filter(e => mine.has(e.project_id)) })
  }
  return NextResponse.json({ entries: data ?? [] })
}
