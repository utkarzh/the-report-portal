import { NextRequest, NextResponse } from 'next/server'
import { toFile } from 'openai'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getOpenAIClient, TRANSCRIBE_MODEL, TRANSCRIPTION_AUDIO_BUCKET } from '@/lib/openai/client'

// POST /api/transcriptions/[id]/transcribe — transcribes a SINGLE audio chunk
// and streams it back as Server-Sent Events. The client calls this once per
// chunk, in order, so every serverless request stays short (well inside the
// platform's execution-time limit) even for hour-long recordings.
//
// Body: { chunkIndex: number }. When the last remaining chunk finishes, the
// per-chunk transcripts are joined into raw_transcript and status flips to
// 'transcribed'.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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

  const { data: row } = await supabaseAdmin
    .from('transcriptions')
    .select('id, user_id, audio_path, audio_filename, audio_mime, chunk_paths, chunk_transcripts')
    .eq('id', params.id)
    .single()

  if (!row) return NextResponse.json({ error: 'Transcription not found' }, { status: 404 })
  if (row.user_id !== user.id && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Resolve the chunk list (fall back to the original file as a single chunk).
  const chunkPaths: string[] = Array.isArray(row.chunk_paths) && row.chunk_paths.length > 0
    ? row.chunk_paths
    : [row.audio_path]

  const body = await request.json().catch(() => ({}))
  const chunkIndex = Number((body as { chunkIndex?: number }).chunkIndex ?? 0)

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkPaths.length) {
    return NextResponse.json({ error: 'Invalid chunkIndex' }, { status: 400 })
  }

  const chunkPath = chunkPaths[chunkIndex]
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ''
      let clientConnected = true
      const sendRaw = (data: string) => {
        if (!clientConnected) return
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {
          clientConnected = false
        }
      }
      const send = (payload: unknown) => sendRaw(JSON.stringify(payload))

      try {
        // Mark transcribing on the first chunk.
        if (chunkIndex === 0) {
          await supabaseAdmin
            .from('transcriptions')
            .update({ status: 'transcribing', transcribe_model: TRANSCRIBE_MODEL, error: null })
            .eq('id', row.id)
        }

        const { data: blob, error: dlError } = await supabaseAdmin
          .storage
          .from(TRANSCRIPTION_AUDIO_BUCKET)
          .download(chunkPath)

        if (dlError || !blob) throw new Error('Could not download audio chunk from storage')

        const buffer = Buffer.from(await blob.arrayBuffer())
        const file = await toFile(buffer, chunkPath.split('/').pop() || 'chunk.mp3', {
          type: row.audio_mime || 'audio/mpeg',
        })

        const openai = getOpenAIClient()
        const transcriptStream = await openai.audio.transcriptions.create({
          file,
          model: TRANSCRIBE_MODEL,
          stream: true,
        })

        for await (const event of transcriptStream) {
          if (event.type === 'transcript.text.delta') {
            fullText += event.delta
            send({ text: event.delta })
          } else if (event.type === 'transcript.text.done') {
            if (event.text) fullText = event.text
          }
        }

        // Store this chunk's text, then join if every chunk is now present.
        // The client transcribes chunks sequentially, so this read-modify-write
        // is race-free.
        const { data: fresh } = await supabaseAdmin
          .from('transcriptions')
          .select('chunk_transcripts')
          .eq('id', row.id)
          .single()

        const transcripts: (string | null)[] = Array.isArray(fresh?.chunk_transcripts)
          ? [...fresh!.chunk_transcripts]
          : new Array(chunkPaths.length).fill(null)
        transcripts[chunkIndex] = fullText

        const allDone = transcripts.length === chunkPaths.length && transcripts.every((t) => t != null)

        await supabaseAdmin
          .from('transcriptions')
          .update({
            chunk_transcripts: transcripts,
            ...(allDone
              ? { raw_transcript: transcripts.join('\n\n').trim(), status: 'transcribed' }
              : {}),
            error: null,
          })
          .eq('id', row.id)

        send({ chunkDone: chunkIndex, allDone })
        sendRaw('[DONE]')
      } catch (err) {
        console.error('Transcription stream error:', err)
        await supabaseAdmin
          .from('transcriptions')
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : 'Transcription failed',
          })
          .eq('id', row.id)
        send({ error: 'Transcription failed. Please try again.' })
      } finally {
        try {
          controller.close()
        } catch {}
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
