import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { INTERVIEW_LETTER_SAMPLES_BUCKET } from '@/lib/interview-letters'
import { SAMPLE_LIST_COLUMNS, cleanSampleMeta } from '@/lib/interview-letter-samples'

interface Params {
  params: { id: string }
}

async function requireAdmin() {
  const auth = await getApiUser()
  if (!auth.user) return auth
  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  if (profile?.role !== 'admin') {
    return { user: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}

// PATCH — admin only: edit a sample's title and tags (company, letter
// version, sector, notes). The file itself is replaced by delete + re-upload.
export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const body = await request.json().catch(() => ({}))
  if (typeof body.title === 'string' && !body.title.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  // Only the fields sent are changed.
  const meta = cleanSampleMeta(body)
  const updates: Record<string, unknown> = {}
  for (const k of ['company', 'variant', 'sector', 'notes'] as const) {
    if (body[k] !== undefined) updates[k] = meta[k]
  }
  if (typeof body.title === 'string') updates.title = body.title.trim()

  const { data, error } = await supabaseAdmin
    .from('interview_letter_samples')
    .update(updates)
    .eq('id', params.id)
    .select(SAMPLE_LIST_COLUMNS)
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message || 'Sample not found' }, { status: error ? 500 : 404 })
  return NextResponse.json({ sample: data })
}

// DELETE — admin only. Removes the row AND the storage object.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin()
  if (!admin.user) return admin.response

  const { data: row } = await supabaseAdmin
    .from('interview_letter_samples')
    .select('id, storage_path')
    .eq('id', params.id)
    .single()
  if (!row) return NextResponse.json({ error: 'Sample not found' }, { status: 404 })

  // Best-effort: a storage failure shouldn't block deleting the row.
  if (row.storage_path) {
    const { error: storageError } = await supabaseAdmin.storage.from(INTERVIEW_LETTER_SAMPLES_BUCKET).remove([row.storage_path])
    if (storageError) console.error('Failed to remove sample letter object:', storageError)
  }

  const { error } = await supabaseAdmin.from('interview_letter_samples').delete().eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
