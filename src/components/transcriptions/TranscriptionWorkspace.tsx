'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import { AudioLines, Mic, WandSparkles, FileText, Loader2, Download, Languages, ChevronDown, Copy, Check } from 'lucide-react'
import type { Transcription } from '@/types'
import { TRANSCRIPTION_PROVIDER, TRANSLATION_LANGUAGES, type TranslationLanguage } from '@/lib/transcriptions'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// AssemblyAI returns the diarized transcript in one batch (no token stream), so
// once it lands we reveal it progressively to give a streaming feel rather than
// dumping the whole thing at once. Length-independent: ~2s total regardless of
// transcript size.
async function revealText(full: string, onUpdate: (t: string) => void) {
  const FRAMES = 140
  const step = Math.max(2, Math.ceil(full.length / FRAMES))
  for (let i = step; i < full.length; i += step) {
    onUpdate(full.slice(0, i))
    await sleep(16)
  }
  onUpdate(full)
}

marked.use({ gfm: true, breaks: true })

// Keeps a scroll container pinned to the bottom as content streams in, BUT only
// while the user is already near the bottom. The moment they scroll up, it stops
// auto-following so they can read earlier text mid-stream; scrolling back down
// re-engages it.
function useStickToBottom(dep: string) {
  const ref = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  function onScroll() {
    const el = ref.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [dep])
  return { ref, onScroll }
}

// Copies text to the clipboard with brief "Copied" feedback. Same quiet styling
// as the Download control it sits beside.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (e.g. insecure context) — no-op */
    }
  }
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
    >
      {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

type RefineSource = 'raw' | 'translated'

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
  const [waitSecs, setWaitSecs] = useState(0)
  // Translation (single slot). `translatedLang` is the language of the saved
  // translation; `selectedLang` is the dropdown choice for the next translate.
  const [translated, setTranslated] = useState(transcription.translated_transcript || '')
  const [translatedLang, setTranslatedLang] = useState<string | null>(transcription.translation_language)
  const [selectedLang, setSelectedLang] = useState<TranslationLanguage>(
    (transcription.translation_language as TranslationLanguage) || TRANSLATION_LANGUAGES[0],
  )
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [showLangPicker, setShowLangPicker] = useState(false)
  const [refineSource, setRefineSource] = useState<RefineSource>('raw')
  const [showRefinePicker, setShowRefinePicker] = useState(false)
  const [usage, setUsage] = useState({
    tokens_total: transcription.tokens_total || 0,
    cost_usd: Number(transcription.cost_usd) || 0,
  })

  const hasStartedRef = useRef(false)
  const [rawCollapsed, setRawCollapsed] = useState(false)
  const [translatedCollapsed, setTranslatedCollapsed] = useState(false)
  const [refinedCollapsed, setRefinedCollapsed] = useState(false)
  const rawScroll = useStickToBottom(raw)
  const translatedScroll = useStickToBottom(translated)
  const refinedScroll = useStickToBottom(refined)

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

  useEffect(() => {
    document.body.style.overflow = showLangPicker || showRefinePicker ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [showLangPicker, showRefinePicker])

  async function startTranscribe() {
    if (TRANSCRIPTION_PROVIDER === 'assemblyai') {
      return startTranscribeAssemblyAI()
    }
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

  // AssemblyAI is an async job: submit once, then poll to completion. It does
  // not stream partial text, so the raw view stays in its "Transcribing…" state
  // until the full speaker-labelled transcript arrives in one go.
  async function startTranscribeAssemblyAI() {
    setTranscribeError(null)
    setTranscribing(true)
    setRaw('')
    setWaitSecs(0)
    // Live elapsed clock so the wait doesn't feel frozen while AssemblyAI works.
    const startedAt = Date.now()
    const ticker = setInterval(() => setWaitSecs(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    try {
      const submit = await fetch(`/api/transcriptions/${transcription.id}/transcribe-assemblyai`, {
        method: 'POST',
      })
      if (!submit.ok) {
        const d = await submit.json().catch(() => ({}))
        throw new Error(d.error || 'Could not start transcription.')
      }

      // Poll ~every 3s. Cap the loop as a safety net (well beyond real durations).
      for (let attempt = 0; attempt < 1200; attempt++) {
        await sleep(3000)
        const res = await fetch(`/api/transcriptions/${transcription.id}/transcribe-assemblyai`)
        if (!res.ok) continue // transient — keep polling
        const data = (await res.json()) as { status?: string; text?: string; error?: string }

        if (data.status === 'completed') {
          clearInterval(ticker)
          // Reveal progressively so it reads like a stream instead of appearing all at once.
          await revealText(data.text || '', setRaw)
          router.refresh()
          return
        }
        if (data.status === 'error') {
          throw new Error(data.error || 'Transcription failed. Please try again.')
        }
        // queued | processing | not_started → keep waiting
      }
      throw new Error('Transcription is taking longer than expected. Please try again.')
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : 'Transcription failed. Please try again.')
    } finally {
      clearInterval(ticker)
      setTranscribing(false)
    }
  }

  // Refine either the raw transcript or the translation. Streams like before.
  async function startRefine(source: RefineSource) {
    setShowRefinePicker(false)
    setRefineSource(source)
    setRefineError(null)
    setRefining(true)
    setRefined('')
    let acc = ''
    try {
      await consumeStream(
        `/api/transcriptions/${transcription.id}/refine`,
        (text) => { acc += text; setRefined(acc) },
        (u) => setUsage(u),
        { source },
      )
      router.refresh()
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : 'Refining failed. Please try again.')
    } finally {
      setRefining(false)
    }
  }

  // Clicking Refine: if a translation exists, ask which source to refine;
  // otherwise refine the raw transcript directly.
  function onRefineClick() {
    if (hasTranslation) setShowRefinePicker(true)
    else startRefine('raw')
  }

  // Translate the raw transcript into the selected language (single slot —
  // overwrites any previous translation). Streams like refine.
  async function startTranslate() {
    setTranslateError(null)
    setTranslating(true)
    setTranslated('')
    let acc = ''
    try {
      await consumeStream(
        `/api/transcriptions/${transcription.id}/translate`,
        (text) => { acc += text; setTranslated(acc) },
        (u) => setUsage(u),
        { language: selectedLang },
      )
      setTranslatedLang(selectedLang)
      router.refresh()
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : 'Translation failed. Please try again.')
    } finally {
      setTranslating(false)
    }
  }

  // Confirm from the language popup: close it and kick off the translation.
  function confirmTranslate() {
    setShowLangPicker(false)
    startTranslate()
  }

  const rawReady = Boolean(raw) && !transcribing
  const hasRefined = Boolean(refined)
  const hasTranslation = Boolean(translated)

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
          <button
            onClick={() => setRawCollapsed((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 transition-colors hover:text-gray-800"
          >
            <ChevronDown size={14} className={`transition-transform ${rawCollapsed ? '-rotate-90' : ''}`} />
            <Mic size={13} />
            <span>Raw transcript</span>
          </button>
          <div className="flex items-center gap-1">
            {transcribing ? (
              <span className="flex items-center gap-2 pr-2 text-xs text-gray-500">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8973f]" />
                Transcribing…
              </span>
            ) : raw ? (
              <>
                <CopyButton text={raw} />
                <a
                  href={`/api/transcriptions/${transcription.id}/download?variant=raw`}
                  title="Download raw transcript (.docx)"
                  className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                >
                  <Download size={13} />
                  <span>Download</span>
                </a>
              </>
            ) : null}
          </div>
        </div>

        {!rawCollapsed && (
          <>
            <div
              ref={rawScroll.ref}
              onScroll={rawScroll.onScroll}
              className="mt-4 max-h-[440px] min-h-[160px] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-gray-700"
            >
              {raw ? (
                <>
                  {raw}
                  {transcribing && <span className="cursor-blink select-none text-gray-300">▋</span>}
                </>
              ) : transcribing ? (
                <span className="flex items-center gap-2 text-gray-400">
                  <span>
                    {TRANSCRIPTION_PROVIDER === 'assemblyai'
                      ? `Transcribing and identifying speakers${waitSecs ? ` · ${waitSecs}s` : ''}… this can take a few minutes for long recordings.`
                      : 'Listening to the audio…'}
                  </span>
                  <span className="cursor-blink select-none">▋</span>
                </span>
              ) : (
                <span className="text-gray-400">No transcript yet.</span>
              )}
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

            {/* Actions: translate (left) · refine (right) */}
            {rawReady && (
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#e5e3df] pt-5">
                <button
                  onClick={() => setShowLangPicker(true)}
                  disabled={translating || refining}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-4 text-sm font-medium tracking-wide text-gray-700 transition-colors hover:border-gray-300 hover:bg-[#faf9f7] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {translating ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
                  <span>
                    {translating ? 'Translating…' : hasTranslation ? `Translated · ${translatedLang}` : 'Translate'}
                  </span>
                </button>

                <button
                  onClick={onRefineClick}
                  disabled={refining || translating}
                  className="ml-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-black px-5 text-sm font-medium tracking-wide text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {refining ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}
                  <span>{refining ? 'Refining…' : hasRefined ? 'Refine again' : 'Refine'}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Translated transcript */}
      {(translating || hasTranslation || translateError) && (
        <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setTranslatedCollapsed((v) => !v)}
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 transition-colors hover:text-gray-800"
            >
              <ChevronDown size={14} className={`transition-transform ${translatedCollapsed ? '-rotate-90' : ''}`} />
              <Languages size={13} />
              <span>Translated transcript{translatedLang ? ` · ${translatedLang}` : ''}</span>
            </button>
            <div className="flex items-center gap-1">
              {translating ? (
                <span className="flex items-center gap-2 pr-2 text-xs text-gray-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8973f]" />
                  Translating…
                </span>
              ) : hasTranslation ? (
                <>
                  <CopyButton text={translated} />
                  <a
                    href={`/api/transcriptions/${transcription.id}/download?variant=translated`}
                    title="Download translation (.docx)"
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </a>
                </>
              ) : null}
            </div>
          </div>

          {!translatedCollapsed && (
          <div
            ref={translatedScroll.ref}
            onScroll={translatedScroll.onScroll}
            className="mt-4 max-h-[440px] min-h-[120px] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-gray-700"
          >
            {translated ? (
              <>
                {translated}
                {translating && <span className="cursor-blink select-none text-gray-300">▋</span>}
              </>
            ) : translating ? (
              <span className="flex items-center gap-2 text-gray-400">
                <span>Translating the transcript…</span>
                <span className="cursor-blink select-none">▋</span>
              </span>
            ) : null}
          </div>
          )}

          {translateError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{translateError}</span>
              <button
                onClick={startTranslate}
                className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* Refined transcript */}
      {(refining || hasRefined || refineError) && (
        <div className="rounded-2xl border border-[#e5e3df] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setRefinedCollapsed((v) => !v)}
              className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500 transition-colors hover:text-gray-800"
            >
              <ChevronDown size={14} className={`transition-transform ${refinedCollapsed ? '-rotate-90' : ''}`} />
              <FileText size={13} />
              <span>Refined transcript</span>
            </button>
            <div className="flex items-center gap-1">
              {refining ? (
                <span className="flex items-center gap-2 pr-2 text-xs text-gray-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#c8973f]" />
                  Refining…
                </span>
              ) : hasRefined ? (
                <>
                  <CopyButton text={refined} />
                  <a
                    href={`/api/transcriptions/${transcription.id}/download?variant=refined`}
                    title="Download refined transcript (.docx)"
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-[#f7f6f3] hover:text-gray-900"
                  >
                    <Download size={13} />
                    <span>Download</span>
                  </a>
                </>
              ) : null}
            </div>
          </div>

          {!refinedCollapsed && (
          <div className="mt-4 max-h-[440px] min-h-[120px] overflow-y-auto text-sm leading-7 text-gray-800" ref={refinedScroll.ref} onScroll={refinedScroll.onScroll}>
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
          </div>
          )}

          {refineError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span>{refineError}</span>
              <button
                onClick={() => startRefine(refineSource)}
                className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-red-700 underline underline-offset-2 hover:text-red-900"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
      {/* Language picker popup */}
      {showLangPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowLangPicker(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-gray-900">
              <Languages size={16} />
              <h3 className="text-sm font-semibold">Translate transcript</h3>
            </div>
            <p className="mt-1.5 text-sm text-gray-500">
              Choose a language. Only one translation is kept — this replaces any existing one.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              {TRANSLATION_LANGUAGES.map((lang) => {
                const active = selectedLang === lang
                return (
                  <button
                    key={lang}
                    onClick={() => setSelectedLang(lang)}
                    className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? 'border-black bg-black text-white'
                        : 'border-[#e5e3df] text-gray-700 hover:border-gray-300 hover:bg-[#faf9f7]'
                    }`}
                  >
                    {lang}
                  </button>
                )
              })}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowLangPicker(false)}
                className="flex-1 rounded-lg border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-[#f7f6f3]"
              >
                Cancel
              </button>
              <button
                onClick={confirmTranslate}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
              >
                <Languages size={15} />
                <span>Translate</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refine source picker — shown only when a translation also exists */}
      {showRefinePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowRefinePicker(false)} />
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-gray-900">
              <WandSparkles size={16} />
              <h3 className="text-sm font-semibold">Refine which transcript?</h3>
            </div>
            <p className="mt-1.5 text-sm text-gray-500">
              Choose the version to clean up. This replaces the current refined transcript.
            </p>

            <div className="mt-5 space-y-2">
              <button
                onClick={() => startRefine('raw')}
                className="flex w-full items-center gap-3 rounded-lg border border-[#e5e3df] px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-[#faf9f7]"
              >
                <Mic size={16} className="shrink-0 text-gray-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">Raw transcript</span>
                  <span className="block text-xs text-gray-500">The original transcription</span>
                </span>
              </button>
              <button
                onClick={() => startRefine('translated')}
                className="flex w-full items-center gap-3 rounded-lg border border-[#e5e3df] px-4 py-3 text-left transition-colors hover:border-gray-300 hover:bg-[#faf9f7]"
              >
                <Languages size={16} className="shrink-0 text-gray-400" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-gray-900">
                    Translated transcript{translatedLang ? ` · ${translatedLang}` : ''}
                  </span>
                  <span className="block text-xs text-gray-500">The translated version</span>
                </span>
              </button>
            </div>

            <button
              onClick={() => setShowRefinePicker(false)}
              className="mt-6 w-full rounded-lg border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-[#f7f6f3]"
            >
              Cancel
            </button>
          </div>
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
