import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isSalesCoachOutcome } from '@/lib/sales-coach'
import type { SalesCoachNegotiation, SalesCoachReview } from '@/types'

export const runtime = 'nodejs'

// POST /api/sales-coach/[id]/review — an admin resolves (or reopens) a
// management-review flag (US-045). No schema change: the resolution lives in
// the card JSON (`report_card.review`) and is mirrored to the row's reserved
// actual_outcome / actual_outcome_source / actual_outcome_at columns, so
// "reviewed" = actual_outcome_at IS NOT NULL and the flag itself stays as the
// permanent record that the card raised it.
//   { confirmedOutcome: 'signed'|'retorno'|'lost'|'uncertain', note?: string }
//   { reopen: true }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, full_name')
    .eq('id', user.id)
    .single()
  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can review negotiations' }, { status: 403 })
  }

  const { data: row } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!row) return NextResponse.json({ error: 'Negotiation not found' }, { status: 404 })
  const n = row as SalesCoachNegotiation
  if (!n.report_card) {
    return NextResponse.json({ error: 'Nothing to review until the Report Card exists' }, { status: 409 })
  }

  const body = (await request.json().catch(() => ({}))) as { confirmedOutcome?: unknown; note?: unknown; reopen?: unknown }

  if (body.reopen === true) {
    const { review: _dropped, ...card } = n.report_card
    void _dropped
    const { data: updated, error } = await supabaseAdmin
      .from('sales_coach_negotiations')
      .update({ report_card: card, actual_outcome: null, actual_outcome_source: null, actual_outcome_at: null })
      .eq('id', n.id)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: 'Could not reopen the review' }, { status: 500 })
    return NextResponse.json({ negotiation: updated })
  }

  if (!isSalesCoachOutcome(body.confirmedOutcome)) {
    return NextResponse.json({ error: 'Pick the confirmed outcome' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  const now = new Date().toISOString()
  const review: SalesCoachReview = {
    reviewed_by: user.id,
    reviewed_by_name: profile.full_name || 'Admin',
    reviewed_at: now,
    confirmed_outcome: body.confirmedOutcome,
    note,
  }

  const { data: updated, error } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .update({
      report_card: { ...n.report_card, review },
      actual_outcome: body.confirmedOutcome,
      actual_outcome_source: 'admin_review',
      actual_outcome_at: now,
      // A card that was never flagged can still be reviewed explicitly; make
      // the flag true so the record shows a review happened.
      management_review: true,
    })
    .eq('id', n.id)
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: 'Could not save the review' }, { status: 500 })
  return NextResponse.json({ negotiation: updated })
}
