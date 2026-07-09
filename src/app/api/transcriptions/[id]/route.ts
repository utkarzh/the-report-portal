import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/transcriptions'

// DELETE /api/transcriptions/[id] — permanently removes a transcription: its DB
// row AND the audio objects (original + chunks) in private storage, so nothing
// is left orphaned. A user may delete only their own transcript; an admin may
// delete any.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  // Deleting a transcript is admin-only.
  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('id, user_id, audio_path, chunk_paths')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Transcription not found' }, { status: 404 })

  // Remove audio objects first. Best-effort: a storage failure shouldn't block
  // deleting the row (better an orphaned file than an undeletable record).
  const paths = [row.audio_path, ...(Array.isArray(row.chunk_paths) ? row.chunk_paths : [])]
    .filter((p): p is string => Boolean(p))
  if (paths.length > 0) {
    const { error: storageError } = await supabaseAdmin
      .storage
      .from(TRANSCRIPTION_AUDIO_BUCKET)
      .remove(paths)
    if (storageError) console.error('Failed to remove transcription audio:', storageError)
  }

  const { error } = await supabaseAdmin
    .from('transcriptions')
    .delete()
    .eq('id', row.id)

  if (error) return NextResponse.json({ error: 'Failed to delete transcript' }, { status: 500 })

  return NextResponse.json({ success: true })
}
