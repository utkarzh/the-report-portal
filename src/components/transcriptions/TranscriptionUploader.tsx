'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileAudio, X, Loader2 } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { TRANSCRIPTION_AUDIO_BUCKET, TRANSCRIPTION_PROVIDER } from '@/lib/transcriptions'

type Phase = 'idle' | 'preparing' | 'transcoding' | 'uploading' | 'creating' | 'error'

// Hard cap on the SOURCE file the user selects. The file is always compressed in
// the browser before upload (to a small 16kHz mono MP3), so what reaches storage
// is tiny — this cap just bounds what ffmpeg.wasm has to chew through in memory.
const MAX_BYTES = 500 * 1024 * 1024 // 500 MB

export default function TranscriptionUploader({ userId }: { userId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [uploadInfo, setUploadInfo] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const busy = phase !== 'idle' && phase !== 'error'

  function pickFile(f: File | undefined | null) {
    if (!f) return
    setError(null)
    if (!f.type.startsWith('audio/') && !/\.(mp3|wav|m4a|mp4|mpeg|mpga|webm|ogg|oga|flac|aac|aiff?)$/i.test(f.name)) {
      setError('Please choose an audio file.')
      return
    }
    if (f.size > MAX_BYTES) {
      setError('That file is too large (max 500 MB).')
      return
    }
    setFile(f)
  }

  async function handleStart() {
    if (!file || busy) return
    setError(null)
    setProgress(0)
    setUploadInfo({ done: 0, total: 0 })
    setPhase('preparing')

    try {
      const supabase = getSupabaseBrowserClient()
      const groupId = crypto.randomUUID()
      const ext = (file.name.split('.').pop() || 'mp3').toLowerCase()
      const originalPath = `${userId}/${groupId}/original.${ext}`

      // The audio object we actually store + transcribe. For AssemblyAI this is a
      // compressed MP3 (set below); for OpenAI it's the original file.
      let audioPath = originalPath
      let chunkPaths: string[] = []
      let durationSeconds: number | null | undefined

      if (TRANSCRIPTION_PROVIDER === 'assemblyai') {
        // Compress the whole file to a compact 16kHz mono MP3 in the browser BEFORE
        // uploading. This keeps big source files (e.g. a 157 MB WAV) off Supabase
        // entirely — the stored MP3 is ~10x smaller, well under storage limits and
        // far cheaper — while remaining fine for AssemblyAI transcription +
        // diarization. This single MP3 is used for both the job and playback.
        setPhase('transcoding')
        const { transcodeToMp3 } = await import('@/lib/ffmpeg-client')
        const { blob, durationSeconds: dur } = await transcodeToMp3(file, {
          onProgress: (r) => setProgress(r),
          onStage: (s) => { if (s === 'transcoding') setPhase('transcoding') },
        })
        durationSeconds = dur

        audioPath = `${userId}/${groupId}/audio.mp3`
        setPhase('uploading')
        setUploadInfo({ done: 0, total: 1 })
        const { error: upErr } = await supabase
          .storage
          .from(TRANSCRIPTION_AUDIO_BUCKET)
          .upload(audioPath, blob, { contentType: 'audio/mpeg', upsert: false })
        if (upErr) throw new Error('Upload failed. Please try again.')
        setUploadInfo({ done: 1, total: 1 })
      } else {
        // OpenAI path: split + downsample in the browser (ffmpeg.wasm). Dynamic
        // import keeps the ffmpeg packages out of the initial bundle.
        setPhase('transcoding')
        const { transcodeAndSegment } = await import('@/lib/ffmpeg-client')
        const seg = await transcodeAndSegment(file, {
          onProgress: (r) => setProgress(r),
          onStage: (s) => { if (s === 'transcoding') setPhase('transcoding') },
        })
        durationSeconds = seg.durationSeconds

        // Upload the original (for playback) + every chunk (for transcription).
        setPhase('uploading')
        setUploadInfo({ done: 0, total: seg.chunks.length + 1 })

        const { error: origErr } = await supabase
          .storage
          .from(TRANSCRIPTION_AUDIO_BUCKET)
          .upload(originalPath, file, { contentType: file.type || undefined, upsert: false })
        if (origErr) throw new Error('Upload failed. Please try again.')
        setUploadInfo({ done: 1, total: seg.chunks.length + 1 })

        for (let i = 0; i < seg.chunks.length; i++) {
          const chunkPath = `${userId}/${groupId}/chunks/${seg.chunks[i].name}`
          const { error: chErr } = await supabase
            .storage
            .from(TRANSCRIPTION_AUDIO_BUCKET)
            .upload(chunkPath, seg.chunks[i].blob, { contentType: 'audio/mpeg', upsert: false })
          if (chErr) throw new Error('Upload failed. Please try again.')
          chunkPaths.push(chunkPath)
          setUploadInfo({ done: i + 2, total: seg.chunks.length + 1 })
        }
      }

      // 3. Record the row. The workspace auto-starts the chunk-by-chunk transcription.
      setPhase('creating')
      const res = await fetch('/api/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioPath,
          chunkPaths,
          filename: file.name,
          mime: file.type,
          sizeBytes: file.size,
          durationSeconds,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.id) {
        throw new Error(data.error || 'Could not start the transcription. Please try again.')
      }

      router.push(`/transcriptions/${data.id}`)
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    }
  }

  const statusLabel =
    phase === 'preparing' ? 'Preparing…'
    : phase === 'transcoding' ? `Processing audio… ${Math.round(progress * 100)}%`
    : phase === 'uploading' ? `Uploading… ${uploadInfo.done}/${uploadInfo.total}`
    : phase === 'creating' ? 'Starting…'
    : 'Transcribe'

  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (!busy) pickFile(e.dataTransfer.files?.[0])
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition ${
          dragOver ? 'border-gray-500 bg-[#f7f6f3]' : 'border-[#d4d0c8] bg-[#fcfbf8] hover:border-gray-400'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div className="rounded-full bg-white p-3 text-gray-700 shadow-sm">
          <Upload size={18} />
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">Drop or select an audio file</p>
        <p className="mt-1 text-xs text-gray-500">MP3, WAV, M4A, WEBM and similar · long recordings supported</p>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="sr-only"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </div>

      {file && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#e5e3df] bg-[#fcfbf8] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-white p-2 text-gray-600 shadow-sm">
              <FileAudio size={16} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
            </div>
          </div>
          {!busy && (
            <button
              type="button"
              onClick={() => { setFile(null); setError(null); if (inputRef.current) inputRef.current.value = '' }}
              className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Remove file"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* Progress bar while processing / uploading */}
      {(phase === 'transcoding' || phase === 'uploading') && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#efece7]">
            <div
              className="h-full rounded-full bg-black transition-all"
              style={{
                width:
                  phase === 'transcoding'
                    ? `${Math.round(progress * 100)}%`
                    : `${uploadInfo.total ? Math.round((uploadInfo.done / uploadInfo.total) * 100) : 0}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {phase === 'transcoding'
              ? 'Converting and splitting the recording in your browser — this runs locally and can take a moment for long files.'
              : 'Uploading audio…'}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end">
        <button
          type="button"
          onClick={handleStart}
          disabled={!file || busy}
          className="inline-flex items-center justify-center gap-2 bg-black px-5 py-2.5 text-sm font-medium uppercase tracking-wide text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          <span>{statusLabel}</span>
        </button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
