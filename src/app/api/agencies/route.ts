import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { isAgencyCode, normalizeAgencyCode } from '@/lib/agencies'
import { listAgencies } from '@/lib/agencies-server'

// The central agency list (migration 047), shared by every module.

// GET — any signed-in user (every module's agency dropdown).
export async function GET() {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  return NextResponse.json({ agencies: await listAgencies() })
}

// POST { name, code } — admins add an agency. The code is the
// short identifier modules store (e.g. "ABR"); it can't be changed later.
export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admins only' }, { status: 403 })

  const body = (await request.json().catch(() => ({}))) as { name?: string; code?: string }
  const name = (body.name || '').trim().slice(0, 120)
  const code = normalizeAgencyCode(body.code || '')
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!isAgencyCode(code)) return NextResponse.json({ error: 'The code must be 2–12 capital letters or digits, e.g. ABR.' }, { status: 400 })

  const { data: last } = await supabaseAdmin.from('agencies').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await supabaseAdmin
    .from('agencies')
    .insert({
      name,
      code,
      sort_order: (last?.sort_order ?? 0) + 1,
      created_by: auth.user.id,
    })
    .select('*')
    .single()
  if (error) {
    const duplicate = /duplicate|unique/i.test(error.message)
    return NextResponse.json(
      { error: duplicate ? 'An agency with that name or code already exists.' : error.message },
      { status: duplicate ? 409 : 500 },
    )
  }
  return NextResponse.json({ agency: data }, { status: 201 })
}
