import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildReportCardDocx } from '@/lib/sales-coach-docx'
import type { SalesCoachNegotiation } from '@/types'

// GET /api/sales-coach/[id]/download — the Report Card as a Word (.docx)
// file. Owner or admin only.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: row } = await supabaseAdmin
    .from('sales_coach_negotiations')
    .select('*')
    .eq('id', params.id)
    .single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const n = row as SalesCoachNegotiation
  if (n.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!n.report_card) {
    return NextResponse.json({ error: 'Report Card not available yet' }, { status: 404 })
  }

  const doc = buildReportCardDocx(n, n.report_card)
  const buffer = await Packer.toBuffer(doc)
  const base = (n.company || 'Negotiation').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'negotiation'
  const filename = `${base} — Report Card.docx`

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
