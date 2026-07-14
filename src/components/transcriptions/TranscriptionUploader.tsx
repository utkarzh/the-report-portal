'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileAudio, X, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { TRANSCRIPTION_AUDIO_BUCKET, TRANSCRIPTION_PROVIDER } from '@/lib/transcriptions'

type Phase = 'idle' | 'preparing' | 'transcoding' | 'uploading' | 'creating' | 'error'

// Hard cap on EACH source file the user selects. Files are always compressed in
// the browser before upload (to a small 16kHz mono MP3), so what reaches storage
// is tiny — this cap just bounds what ffmpeg.wasm has to chew through in memory.
const MAX_BYTES = 500 * 1024 * 1024 // 500 MB per file
// A single interview is occasionally split across a few files; allow a handful,
// joined in order into one recording. Bounded to keep browser memory sane.
const MAX_FILES = 5

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|mp4|mpeg|mpga|webm|ogg|oga|flac|aac|aiff?)$/i

export default function TranscriptionUploader({ userId }: { userId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [uploadInfo, setUploadInfo] = useState({ done: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const busy = phase !== 'idle' && phase !== 'error'

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list) return
    setError(null)
    const incoming = Array.from(list)
    setFiles((prev) => {
      const next = [...prev]
      for (const f of incoming) {
        if (!f.type.startsWith('audio/') && !AUDIO_EXT_RE.test(f.name)) {
          setError('Please choose audio files only.')
          continue
        }
        if (f.size > MAX_BYTES) {
          setError(`"${f.name}" is too large (max 500 MB per file).`)
          continue
        }
        // Dedupe by name+size so re-selecting the same file doesn't double it.
        if (next.some((e) => e.name === f.name && e.size === f.size)) continue
        if (next.length >= MAX_FILES) {
          setError(`You can combine up to ${MAX_FILES} files.`)
          break
        }
        next.push(f)
      }
      return next
    })
  }

  function removeAt(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i))
    setError(null)
  }

  function move(i: number, dir: -1 | 1) {
    setFiles((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  async function handleStart() {
    if (files.length === 0 || busy) return
    setError(null)
    setProgress(0)
    setUploadInfo({ done: 0, total: 0 })
    setPhase('preparing')

    try {
      const supabase = getSupabaseBrowserClient()
      const groupId = crypto.randomUUID()
      const totalBytes = files.reduce((a, f) => a + f.size, 0)
      // Combined label for the record when several files are joined.
      const combinedName =
        files.length === 1
          ? files[0].name
          : `${files[0].name.replace(/\.[^.]+$/, '')} + ${files.length - 1} more`

      let audioPath: string
      const chunkPaths: string[] = []
      let durationSeconds: number | null | undefined
      let mime = 'audio/mpeg'

      if (TRANSCRIPTION_PROVIDER === 'assemblyai') {
        // Concatenate (in order) + compress to ONE 16kHz mono MP3 in the browser,
        // then upload just that. One file → one diarized job → consistent speakers.
        setPhase('transcoding')
        const { transcodeManyToMp3 } = await import('@/lib/ffmpeg-client')
        const { blob, durationSeconds: dur } = await transcodeManyToMp3(files, {
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
        // OpenAI legacy path: join first (if multiple) into one MP3, then split
        // the combined recording into chunks.
        setPhase('transcoding')
        const mod = await import('@/lib/ffmpeg-client')

        let segmentInput: File
        if (files.length === 1) {
          segmentInput = files[0]
        } else {
          const { blob } = await mod.transcodeManyToMp3(files, {
            onProgress: (r) => setProgress(r * 0.5),
            onStage: () => setPhase('transcoding'),
          })
          segmentInput = new File([blob], 'combined.mp3', { type: 'audio/mpeg' })
        }

        const seg = await mod.transcodeAndSegment(segmentInput, {
          onProgress: (r) => setProgress(files.length === 1 ? r : 0.5 + r * 0.5),
          onStage: (s) => { if (s === 'transcoding') setPhase('transcoding') },
        })
        durationSeconds = seg.durationSeconds

        const ext = files.length === 1 ? (files[0].name.split('.').pop() || 'mp3').toLowerCase() : 'mp3'
        const originalPath = `${userId}/${groupId}/original.${ext}`
        audioPath = originalPath
        mime = files.length === 1 ? (files[0].type || 'audio/mpeg') : 'audio/mpeg'

        setPhase('uploading')
        setUploadInfo({ done: 0, total: seg.chunks.length + 1 })
        const { error: origErr } = await supabase
          .storage
          .from(TRANSCRIPTION_AUDIO_BUCKET)
          .upload(originalPath, segmentInput, { contentType: mime, upsert: false })
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

      // Record the row. The workspace auto-starts transcription.
      setPhase('creating')
      const res = await fetch('/api/transcriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioPath,
          chunkPaths,
          filename: combinedName,
          mime,
          sizeBytes: totalBytes,
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
    : files.length > 1 ? 'Combine & Transcribe'
    : 'Transcribe'

  return (
    <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (!busy) addFiles(e.dataTransfer.files)
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center transition ${
          dragOver ? 'border-gray-500 bg-[#f7f6f3]' : 'border-[#d4d0c8] bg-[#fcfbf8] hover:border-gray-400'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <div className="rounded-full bg-white p-3 text-gray-700 shadow-sm">
          <Upload size={18} />
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">Drop or select audio file(s)</p>
        <p className="mt-1 text-xs text-gray-500">MP3, WAV, M4A, WEBM and similar · long recordings supported</p>
        <p className="mt-1 text-xs text-gray-400">Split interview? Add up to {MAX_FILES} files — they&apos;re joined in order into one transcript.</p>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          multiple
          className="sr-only"
          onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = '' }}
        />
      </div>

      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((f, i) => (
            <div
              key={`${f.name}-${f.size}-${i}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e3df] bg-[#fcfbf8] px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                {files.length > 1 && (
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                )}
                <div className="rounded-lg bg-white p-2 text-gray-600 shadow-sm">
                  <FileAudio size={16} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{f.name}</p>
                  <p className="text-xs text-gray-500">{formatBytes(f.size)}</p>
                </div>
              </div>
              {!busy && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {files.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="Move up"
                      >
                        <ChevronUp size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === files.length - 1}
                        className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="Move down"
                      >
                        <ChevronDown size={15} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    aria-label="Remove file"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {files.length > 1 && (
            <p className="text-xs text-gray-500">
              These {files.length} files will be joined in this order into one continuous transcript. Use the arrows to reorder.
            </p>
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
              ? (files.length > 1
                  ? 'Combining and compressing your recordings in your browser — this runs locally and can take a moment for long files.'
                  : 'Converting the recording in your browser — this runs locally and can take a moment for long files.')
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
          disabled={files.length === 0 || busy}
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
