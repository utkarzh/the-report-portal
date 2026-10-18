import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireCiAdmin } from '@/lib/country-intel/auth'

// GET /api/country-intel/[id]/companies — every company of the project (for the workspace's results table).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const { data, error } = await supabaseAdmin.from('ci_companies')
    .select('id, name, origin, sector, status, round, profile, outreach, verdict, contacts_done, verified')
    .eq('project_id', params.id).order('created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ companies: data || [] })
}
