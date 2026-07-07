'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import { AudioLines, Mic, WandSparkles, FileText, Loader2 } from 'lucide-react'
import type { Transcription } from '@/types'

marked.use({ gfm: true, breaks: true })

interface Props {
  transcription: Transcription
  audioUrl: string | null
}

// Reads an SSE stream produced by the transcribe/refine routes, calling
// onDelta for each text chunk and onUsage for the final usage payload. Resolves
// when the stream ends; throws on an { error } event or a non-OK response.
async function consumeStream(
  url: string,
  onDelta: (text: string) => void,
  onUsage?: (usage: { tokens_total: number; cost_usd: number }) => void,
  body?: Record<string, unknown>,
) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Request failed')
  }

  const reader = res.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (reader) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    // Process only complete lines; keep any trailing partial line for the next read.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return
      let parsed: { error?: string; text?: string; usage?: { tokens_total: number; cost_usd: number } }
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue // ignore malformed / partial JSON
      }
      if (parsed.error) throw new Error(parsed.error)
      if (parsed.usage && onUsage) onUsage(parsed.usage)
      else if (parsed.text) onDelta(parsed.text)
    }
  }
}

export default function TranscriptionWorkspace({ transcription, audioUrl }: Props) {
  const router = useRouter()

  const chunkPaths = transcription.chunk_paths ?? []
  const chunkCount = chunkPaths.length || 1
  const chunkTranscripts = transcription.chunk_transcripts ?? []
  // Seed the live view from whatever has already been transcribed.
  const seededRaw =
    transcription.raw_transcript ||
    chunkTranscripts.filter((t): t is string => t != null).join('\n\n')
  // Resume from the first not-yet-transcribed chunk.
  const firstPending = (() => {
    for (let i = 0; i < chunkCount; i++) {
      if (!chunkTranscripts[i]) return i
    }
    return chunkCount
  })()

  const [raw, setRaw] = useState(seededRaw)
  const [refined, setRefined] = useState(transcription.refined_transcript || '')
  const [transcribing, setTranscribing] = useState(false)
  const [refining, setRefining] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const [refineError, setRefineError] = useState<string | null>(null)
  const [usage, setUsage] = useState({
    tokens_total: transcription.tokens_total || 0,
    cost_usd: Number(transcription.cost_usd) || 0,
  })

  const hasStartedRef = useRef(false)
  const rawBottomRef = useRef<HTMLDivElement>(null)
  const refinedBottomRef = useRef<HTMLDivElement>(null)

  // Auto-start transcription for a record that still has pending chunks.
  useEffect(() => {
    const needsTranscription =
      !transcription.raw_transcript &&
      firstPending < chunkCount &&
      transcription.status !== 'failed' &&
      !hasStartedRef.current
    if (needsTranscription) {
      hasStartedRef.current = true
      startTranscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { rawBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [raw])
  useEffect(() => { refinedBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [refined])

  async function startTranscribe() {
    setTranscribeError(null)
    setTranscribing(true)
    // Keep any already-transcribed chunks on screen; resume from the first pending one.
    let acc = seededRaw
    setRaw(acc)
    try {
      for (let i = firstPending; i < chunkCount; i++) {
        if (acc) acc += '\n\n'
        await consumeStream(
          `/api/transcriptions/${transcription.id}/transcribe`,
          (text) => { acc += text; setRaw(acc) },
          undefined,
          { chunkIndex: i },
        )
      }
      router.refresh()
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : 'Transcription failed. Please try again.')
    } finally {
      setTranscribing(false)
    }
  }

  async function startRefine() {
    setRefineError(null)
    setRefining(true)
    setRefined('')
    let acc = ''
    try {
      await consumeStream(
        `/api/transcriptions/${transcription.id}/refine`,
        (text) => { acc += text; setRefined(acc) },
        (u) => setUsage(u),
      )
      router.refresh()
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : 'Refining failed. Please try again.')
    } finally {
      setRefining(false)
    }
  }

  const rawReady = Boolean(raw) && !transcribing
  const hasRefined = Boolean(refined)

  return (
    <div className="flex flex-col gap-6">
      {/* Header + audio */}
      <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
            <AudioLines size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-gray-900">{transcription.title}</h1>
            <p className="mt-1 truncate text-sm text-gray-500">
              {transcription.audio_filename || 'audio'}
              {usage.tokens_total > 0 && (
                <span className="text-gray-400"> · {formatTokens(usage.tokens_total)} tokens · ${usage.cost_usd.toFixed(4)}</span>
              )}
            </p>
          </div>
        </div>

        {audioUrl ? (
          <audio controls src={audioUrl} className="mt-5 w-full">
            Your browser does not support the audio element.
          </audio>
        ) : (
          <p className="mt-5 text-sm text-gray-400">Audio preview unavailable.</p>
        )}
      </div>

      {/* Raw transcript */}
      <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
            <Mic size={13} />
            <span>Raw transcript</span>
          </div>
          {transcribing && (
            <span className="flex items-center gap-2 text-xs text-gray-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8973f]" />
              Transcribing…
            </span>
          )}
        </div>

        <div className="mt-4 min-h-[160px] whitespace-pre-wrap text-sm leading-7 text-gray-700">
          {raw ? (
            <>
              {raw}
              {transcribing && <span className="cursor-blink select-none text-gray-300">▋</span>}
            </>
          ) : transcribing ? (
            <span className="flex items-center gap-2 text-gray-400">
              <span>Listening to the audio…</span>
              <span className="cursor-blink select-none">▋</span>
            </span>
          ) : (
            <span className="text-gray-400">No transcript yet.</span>
          )}
          <div ref={rawBottomRef} />
        </div>

        {transcribeError && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{transcribeError}</span>
            <button
              onClick={startTranscribe}
              className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
            >
              Try again
            </button>
          </div>
        )}

        {/* Refine action */}
        {rawReady && (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#e5e3df] pt-5">
            <button
              onClick={startRefine}
              disabled={refining}
              className="inline-flex items-center justify-center gap-2 bg-black px-5 py-2.5 text-sm font-medium uppercase tracking-wide text-white transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refining ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}
              <span>{refining ? 'Refining…' : hasRefined ? 'Refine again' : 'Refine transcription'}</span>
            </button>
            <span className="text-xs text-gray-400">
              Cleans up the raw transcript using the admin refining prompt.
            </span>
          </div>
        )}
      </div>

      {/* Refined transcript */}
      {(refining || hasRefined || refineError) && (
        <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">
              <FileText size={13} />
              <span>Refined transcript</span>
            </div>
            {refining && (
              <span className="flex items-center gap-2 text-xs text-gray-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8973f]" />
                Refining…
              </span>
            )}
          </div>

          <div className="mt-4 min-h-[120px] text-sm leading-7 text-gray-800">
            {refined ? (
              <>
                <div
                  className="prose-research"
                  dangerouslySetInnerHTML={{ __html: marked.parse(refined) as string }}
                />
                {refining && <span className="cursor-blink select-none text-gray-300">▋</span>}
              </>
            ) : refining ? (
              <span className="flex items-center gap-2 text-gray-400">
                <span>Refining the transcript…</span>
                <span className="cursor-blink select-none">▋</span>
              </span>
            ) : null}
            <div ref={refinedBottomRef} />
          </div>

          {refineError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{refineError}</span>
              <button
                onClick={startRefine}
                className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}
