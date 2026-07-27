import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { DOCUMENT_SAMPLES_BUCKET } from '@/lib/documents'

// DELETE /api/document-samples/[id] — admin-only. Removes the DB row AND the
// underlying storage object so nothing is orphaned.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: row } = await supabaseAdmin
    .from('document_samples')
    .select('id, storage_path')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Sample not found' }, { status: 404 })

  // Remove the object first (best-effort: a storage failure shouldn't block
  // deleting the row).
  if (row.storage_path) {
    const { error: storageError } = await supabaseAdmin
      .storage
      .from(DOCUMENT_SAMPLES_BUCKET)
      .remove([row.storage_path])
    if (storageError) console.error('Failed to remove sample object:', storageError)
  }

  const { error } = await supabaseAdmin.from('document_samples').delete().eq('id', row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
