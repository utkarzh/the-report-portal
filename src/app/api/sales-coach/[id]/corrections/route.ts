import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import type { SalesCoachNegotiation } from '@/types'

export const runtime = 'nodejs'

interface Params {
  params: { id: string }
}

async function authorise(id: string) {
  const auth = await getApiUser()
  if (!auth.user) return { error: auth.response }
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status')
    .eq('id', user.id)
    .single()
  if (!profile || profile.status === 'inactive') {
    return { error: NextResponse.json({ error: 'Account inactive' }, { status: 403 }) }
  }

  const { data: neg } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('id, user_id')
    .eq('id', id)
    .single()
  if (!neg) return { error: NextResponse.json({ error: 'Negotiation not found' }, { status: 404 }) }
  const n = neg as Pick<SalesCoachNegotiation, 'id' | 'user_id'>
  if (n.user_id !== user.id && profile.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { user, profile }
}

// GET /api/sales-coach/[id]/corrections — every fact the Sales Executive has
// corrected for this negotiation (owner or admin).
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await authorise(params.id)
  if (auth.error) return auth.error

  const { data: corrections } = await supabaseAdmin
    .from('sales_coach_corrections')
    .select('*')
    .eq('negotiation_id', params.id)
    .order('created_at')

  return NextResponse.json({ corrections: corrections || [] })
}

// POST /api/sales-coach/[id]/corrections — record a fact the AI got wrong
// (a misheard number, a fact that happened off the recording). No Claude
// call here and no token cost — this only records the fact. The Sales
// Executive explicitly regenerates afterward (their own "should I go ahead?"
// step), which reuses the existing /analyze route; every correction on
// record is folded into every future regenerate from then on.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authorise(params.id)
  if (auth.error) return auth.error

  const body = await request.json().catch(() => ({})) as {
    criterionKey?: string | null
    fieldLabel?: string
    aiSaid?: string
    correction?: string
  }
  const fieldLabel = (body.fieldLabel || '').trim()
  const correction = (body.correction || '').trim()
  if (!fieldLabel || !correction) {
    return NextResponse.json({ error: 'A field label and the correction are required' }, { status: 400 })
  }

  const { data: created, error } = await supabaseAdmin
    .from('sales_coach_corrections')
    .insert({
      negotiation_id: params.id,
      criterion_key: body.criterionKey || null,
      field_label: fieldLabel,
      ai_said: (body.aiSaid || '').trim() || null,
      correction,
      submitted_by: auth.user!.id,
    })
    .select('*')
    .single()

  if (error || !created) {
    console.error('Sales coach correction insert failed:', error)
    return NextResponse.json({ error: 'Could not save the correction' }, { status: 500 })
  }

  return NextResponse.json({ correction: created })
}
