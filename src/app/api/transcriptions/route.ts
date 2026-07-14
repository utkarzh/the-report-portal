import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/openai/client'

// POST /api/transcriptions — creates the transcription record for an audio file
// the client has ALREADY uploaded directly to the private storage bucket. Does
// not call OpenAI. The client then navigates to /transcriptions/[id], which
// starts the streaming transcription via POST /api/transcriptions/[id]/transcribe.
//
// Uploading straight to storage from the browser (RLS-scoped to the user's own
// folder) keeps large audio files off the API request body, which has a small
// size limit on serverless platforms.
export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status === 'inactive') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }

  const body = await request.json()
  const { audioPath, chunkPaths, filename, mime, sizeBytes, durationSeconds, topicOutline, topicOutlineFilename } = body as {
    audioPath?: string
    chunkPaths?: string[]
    filename?: string
    mime?: string
    sizeBytes?: number
    durationSeconds?: number
    topicOutline?: string
    topicOutlineFilename?: string
  }

  if (!audioPath || typeof audioPath !== 'string') {
    return NextResponse.json({ error: 'audioPath is required' }, { status: 400 })
  }

  // Chunks are only used by the OpenAI path. The AssemblyAI path transcribes the
  // whole original file (audio_path) as one diarized job, so chunkPaths is empty.
  const chunks = Array.isArray(chunkPaths) ? chunkPaths.filter((p) => typeof p === 'string') : []

  // Every object path (original + chunks) must live inside the caller's own
  // folder ("<uid>/…"). Mirrors the storage RLS and stops a user registering
  // someone else's file.
  const allPaths = [audioPath, ...chunks]
  if (allPaths.some((p) => !p.startsWith(`${user.id}/`))) {
    return NextResponse.json({ error: 'Invalid audio path' }, { status: 403 })
  }

  // Confirm the original object actually exists before creating a row.
  const { data: fileMeta, error: statError } = await supabaseAdmin
    .storage
    .from(TRANSCRIPTION_AUDIO_BUCKET)
    .createSignedUrl(audioPath, 60)

  if (statError || !fileMeta) {
    return NextResponse.json({ error: 'Uploaded audio not found in storage' }, { status: 400 })
  }

  const cleanName = (filename || 'audio').split('/').pop() || 'audio'
  const title = cleanName.replace(/\.[^.]+$/, '') || 'Untitled transcript'

  const { data: row, error: insertError } = await supabaseAdmin
    .from('transcriptions')
    .insert({
      user_id: user.id,
      title,
      audio_path: audioPath,
      chunk_paths: chunks,
      chunk_transcripts: new Array(chunks.length).fill(null),
      audio_filename: cleanName,
      audio_mime: mime || null,
      audio_size_bytes: typeof sizeBytes === 'number' ? sizeBytes : null,
      duration_seconds: typeof durationSeconds === 'number' ? durationSeconds : null,
      topic_outline: typeof topicOutline === 'string' && topicOutline.trim() ? topicOutline.trim() : null,
      topic_outline_filename:
        typeof topicOutlineFilename === 'string' && topicOutlineFilename.trim()
          ? topicOutlineFilename.trim().split('/').pop()
          : null,
      status: 'uploaded',
    })
    .select('id')
    .single()

  if (insertError || !row) {
    return NextResponse.json({ error: 'Failed to create transcription' }, { status: 500 })
  }

  return NextResponse.json({ id: row.id }, { status: 201 })
}
