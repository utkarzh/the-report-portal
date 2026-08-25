import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { isFinanceAdmin } from '@/lib/access'

interface Params { params: { id: string } }

// POST /api/finance/incidents/[id]/messages — brief G-01: "the director
// replies ... in the same thread." Both the director and Finance can post.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error
  const { profile } = auth

  const { data: incident } = await supabaseAdmin.from('finance_incidents').select('*, finance_cajas(project_id)').eq('id', params.id).single()
  if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isFinanceAdmin(profile)) {
    const { data: membership } = await supabaseAdmin
      .from('finance_project_members')
      .select('id')
      .eq('project_id', incident.finance_cajas.project_id)
      .eq('user_id', profile.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { message } = await request.json()
  if (!message?.trim()) return NextResponse.json({ error: 'A message is required.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('finance_incident_messages')
    .insert({ incident_id: params.id, author_id: profile.id, message: message.trim() })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ message: data }, { status: 201 })
}
