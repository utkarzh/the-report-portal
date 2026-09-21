import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessMeetingPreparation } from '@/lib/access'
import { parseTrackerWorkbook } from '@/lib/meeting-prep-tracker'

export const runtime = 'nodejs'

// GET — list the uploaded trackers (metadata only; not the full entries).
// Their `country` is just an admin-chosen label now — matching (see the
// lookup route) pools every tracker's rows together, worldwide.
export async function GET() {
  const supabase = createSupabaseServerClient()
  const auth = await getApiUser()
  if (!auth.user) return auth.response

  const { data } = await supabase
    .from('meeting_prep_advertiser_tracker')
    .select('id, country, filename, row_count, updated_at')
    .order('country', { ascending: true })

  return NextResponse.json(data || [])
}

// POST — upload a tracker .xlsx under an admin-chosen label (a country, or
// e.g. "Worldwide" for one consolidated file). Parses it server-side and
// upserts by label (re-upload = the weekly update). Any meeting-prep user (or
// admin) may maintain the trackers.
export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status, can_access_meeting_preparation')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (!canAccessMeetingPreparation(profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const country = String(form.get('country') || '').trim()
  const file = form.get('file')
  if (!country) return NextResponse.json({ error: 'Country is required' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'A spreadsheet file is required' }, { status: 400 })
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Please upload an .xlsx, .xlsm or .xls spreadsheet' }, { status: 400 })
  }

  let entries
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    entries = parseTrackerWorkbook(buffer)
  } catch {
    return NextResponse.json({ error: 'Could not read that spreadsheet. Check the file and try again.' }, { status: 400 })
  }
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No rows found — is this the right tracker sheet?' }, { status: 400 })
  }

  // Upsert by country, case-insensitively (keep the caller's spelling).
  const { data: existing } = await supabaseAdmin
    .from('meeting_prep_advertiser_tracker')
    .select('id')
    .ilike('country', country)
    .maybeSingle()

  const payload = {
    country,
    filename: file.name,
    entries,
    row_count: entries.length,
    updated_by: user.id,
  }

  const query = existing
    ? supabaseAdmin.from('meeting_prep_advertiser_tracker').update(payload).eq('id', existing.id)
    : supabaseAdmin.from('meeting_prep_advertiser_tracker').insert(payload)

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidatePath('/admin/meeting-prep/advertiser-tracker')
  return NextResponse.json({ ok: true, country, rows: entries.length, replaced: Boolean(existing) }, { status: existing ? 200 : 201 })
}
