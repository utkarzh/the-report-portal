import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/transcriptions'
import { isTranscriptionAudioAdminEmail } from '@/lib/transcription-admins'

// GET /api/transcriptions/[id]/audio — download the uploaded recording.
// Allowlisted accounts only (see transcription-admins.ts), and only for a
// transcription they can see (their own, or any if they're a platform
// admin). Redirects to a fresh short-lived signed URL (with a download
// filename) — same pattern as the Sales Coach audio route.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user
  if (!isTranscriptionAudioAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('id, user_id, audio_path, audio_filename, title')
    .eq('id', params.id)
    .single()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!row.audio_path) {
    return NextResponse.json({ error: 'No audio was uploaded for this transcription' }, { status: 404 })
  }

  const filename = (row.audio_filename || `${row.title || 'Transcription'}.mp3`)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim() || 'Transcription audio.mp3'

  const { data: signed, error } = await supabaseAdmin
    .storage
    .from(TRANSCRIPTION_AUDIO_BUCKET)
    .createSignedUrl(row.audio_path, 60, { download: filename })
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not prepare the audio for download' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } })
}
