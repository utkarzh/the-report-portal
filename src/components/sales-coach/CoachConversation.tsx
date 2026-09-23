'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Volume2, VolumeX, Send, MessageSquare, Radio, Sparkles, AudioLines } from 'lucide-react'
import { useStickToBottom } from '@/lib/use-stick-to-bottom'
import type { SalesCoachMessage, SalesCoachCoachingPrompt } from '@/types'

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'
type Msg = { role: 'user' | 'assistant'; content: string }

// Minimal typing for the Web Speech API (not in the standard TS lib).
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onstart: (() => void) | null
}

// Generic fallbacks for the rare case the caller has no Report Card to
// personalize from yet — in practice coaching only unlocks once a card
// exists, so this path is mostly defensive.
const FALLBACK_GREETING =
  "Ask me anything about this negotiation. I've read your Report Card, the full transcript and the four TRC knowledge documents — every answer comes from them."
const FALLBACK_STARTERS: SalesCoachCoachingPrompt[] = [
  { label: 'Walk me through my Report Card.', prompt: 'Walk me through my Report Card.' },
  { label: 'Where exactly did I lose control of the negotiation?', prompt: 'Where exactly did I lose control of the negotiation?' },
  { label: 'What should I have said at the decisive moment?', prompt: 'What should I have said at the decisive moment? Give me the TRC wording.' },
  { label: 'Which TRC principle applies to my weakest moment?', prompt: 'Which TRC principle applies to the objection I handled worst?' },
]

export default function CoachConversation({
  negotiationId,
  initialMessages,
  canCoach,
  context,
  initialInput,
  onInitialInputConsumed,
  greeting,
  starters,
}: {
  negotiationId: string
  initialMessages: SalesCoachMessage[]
  canCoach: boolean
  // What the coach has been given — shown as a strip so the executive can
  // see the conversation is grounded, not generic.
  context?: { hasReportCard: boolean; transcriptWords: number }
  // Pre-fills the text box on mount (e.g. the Report Card's "Discuss this
  // with your coach" button, which brings its Final Coaching Question over
  // rather than leaving it a dead end). The caller clears its own copy via
  // onInitialInputConsumed right after mount, so revisiting this tab plainly
  // (not via that button) doesn't keep re-filling it.
  initialInput?: string | null
  onInitialInputConsumed?: () => void
  // Personalized from this negotiation's own Report Card (suggestedCoachingPrompts()/
  // coachGreeting() in sales-coach.ts) — falls back to generic copy if omitted.
  greeting?: string
  starters?: SalesCoachCoachingPrompt[]
}) {
  const [messages, setMessages] = useState<Msg[]>(
    initialMessages.map((m) => ({ role: m.role, content: m.content })),
  )
  const [streaming, setStreaming] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<'voice' | 'text'>('text')
  const [input, setInput] = useState(initialInput || '')
  const [interim, setInterim] = useState('')
  const [muted, setMuted] = useState(false)
  const [handsFree, setHandsFree] = useState(true)
  const [error, setError] = useState('')
  const [sttSupported, setSttSupported] = useState(true)

  // Refs mirroring state for use inside async callbacks / event handlers.
  const streamTextRef = useRef('')
  const spokenLenRef = useRef(0)
  const streamActiveRef = useRef(false)
  const busyRef = useRef(false)
  const mutedRef = useRef(muted)
  const handsFreeRef = useRef(handsFree)
  const modeRef = useRef(mode)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playChainRef = useRef<Promise<void>>(Promise.resolve())
  const speakingCountRef = useRef(0)
  const ttsBrokenRef = useRef(false)
  const SttCtorRef = useRef<(new () => SpeechRecognitionLike) | null>(null)
  // The coaching callbacks form a cycle (goIdle → startListening → send →
  // goIdle); routing the cross-calls through refs keeps each closure current
  // without stale-dependency bugs.
  const sendRef = useRef<(t: string) => void>(() => {})
  const startListeningRef = useRef<() => void>(() => {})

  useEffect(() => { mutedRef.current = muted }, [muted])
  useEffect(() => { handsFreeRef.current = handsFree }, [handsFree])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => {
    if (initialInput) onInitialInputConsumed?.()
    // Only ever meant to fire once, for the mount that received the prefill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scroll = useStickToBottom<HTMLDivElement>(messages.length + streaming.length + interim.length)

  // Detect Web Speech support once on mount.
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition || null
    SttCtorRef.current = Ctor
    if (!Ctor) { setSttSupported(false); setMode('text') }
    audioRef.current = new Audio()
    return () => { stopEverything() } // eslint-disable-line react-hooks/exhaustive-deps
  }, [])

  // ---- Speaking (natural voice out) --------------------------------------

  const goIdle = useCallback(() => {
    setPhase('idle')
    if (handsFreeRef.current && mode === 'voice' && SttCtorRef.current && !busyRef.current) {
      // Re-open the mic so the conversation just keeps flowing.
      window.setTimeout(() => { if (!busyRef.current && speakingCountRef.current === 0) startListeningRef.current() }, 450)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSpeakEnd = useCallback(() => {
    speakingCountRef.current = Math.max(0, speakingCountRef.current - 1)
    if (speakingCountRef.current === 0 && !streamActiveRef.current && !busyRef.current) goIdle()
  }, [goIdle])

  const playUrl = useCallback((url: string) => new Promise<void>((resolve) => {
    const el = audioRef.current
    if (!el) return resolve()
    el.src = url
    el.onended = () => resolve()
    el.onerror = () => resolve()
    el.play().catch(() => resolve())
  }), [])

  const browserSpeak = useCallback((text: string) => new Promise<void>((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.rate = 1.02
      u.pitch = 1.0
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.speak(u)
    } catch { resolve() }
  }), [])

  const fetchTTS = useCallback(async (text: string): Promise<string | null> => {
    try {
      const res = await fetch('/api/sales-coach/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error('tts')
      const blob = await res.blob()
      return URL.createObjectURL(blob)
    } catch {
      ttsBrokenRef.current = true
      return null
    }
  }, [])

  const enqueueSpeech = useCallback((chunk: string) => {
    if (modeRef.current !== 'voice' || mutedRef.current || !chunk.trim()) return
    speakingCountRef.current += 1
    setPhase('speaking')
    // Fetch the audio in parallel; play strictly in order via the chain.
    const fetchPromise = ttsBrokenRef.current ? Promise.resolve<string | null>(null) : fetchTTS(chunk)
    playChainRef.current = playChainRef.current
      .then(() => fetchPromise)
      .then(async (url) => {
        if (url) { await playUrl(url); URL.revokeObjectURL(url) }
        else { await browserSpeak(chunk) }
      })
      .catch(() => {})
      .finally(onSpeakEnd)
  }, [fetchTTS, playUrl, browserSpeak, onSpeakEnd])

  // Emit the newly-completed text (up to the last sentence terminator) as one
  // speech chunk. On `done`, flush whatever remains.
  const speakNewlyComplete = useCallback((done: boolean) => {
    const text = streamTextRef.current
    const from = spokenLenRef.current
    if (from >= text.length) return
    let upTo = text.length
    if (!done) {
      const term = Math.max(
        text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'),
        text.lastIndexOf('…'), text.lastIndexOf('\n'),
      )
      if (term < from) return
      upTo = term + 1
    }
    const chunk = text.slice(from, upTo).trim()
    spokenLenRef.current = upTo
    if (chunk) enqueueSpeech(chunk)
  }, [enqueueSpeech])

  const stopSpeaking = useCallback(() => {
    try { audioRef.current?.pause() } catch {}
    try { window.speechSynthesis?.cancel() } catch {}
    playChainRef.current = Promise.resolve()
    speakingCountRef.current = 0
  }, [])

  // ---- Listening (voice in) ----------------------------------------------

  const startListening = useCallback(() => {
    const Ctor = SttCtorRef.current
    if (!Ctor || busyRef.current) return
    stopSpeaking()
    if (recognitionRef.current) { try { recognitionRef.current.abort() } catch {} }

    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = true
    let finalText = ''

    rec.onresult = (e) => {
      let live = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else live += r[0].transcript
      }
      setInterim((finalText + ' ' + live).trim())
    }
    rec.onerror = () => {}
    rec.onend = () => {
      recognitionRef.current = null
      const text = finalText.trim()
      setInterim('')
      if (text) { sendRef.current(text) }
      else setPhase('idle')
    }

    recognitionRef.current = rec
    setError('')
    setInterim('')
    setPhase('listening')
    try { rec.start() } catch { setPhase('idle') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stopListening = useCallback((send = true) => {
    const rec = recognitionRef.current
    if (!rec) return
    try { send ? rec.stop() : rec.abort() } catch {}
  }, [])

  const stopEverything = useCallback(() => {
    stopListening(false)
    stopSpeaking()
    setPhase('idle')
  }, [stopListening, stopSpeaking])

  // ---- Sending a turn ----------------------------------------------------

  const send = useCallback(async (text: string) => {
    const clean = text.trim()
    if (!clean || busyRef.current) return
    busyRef.current = true
    setError('')
    setMessages((m) => [...m, { role: 'user', content: clean }])
    setInput('')
    setInterim('')
    setPhase('thinking')
    streamTextRef.current = ''
    spokenLenRef.current = 0
    setStreaming('')
    streamActiveRef.current = true

    try {
      const res = await fetch(`/api/sales-coach/${negotiationId}/coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean, mode: modeRef.current }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'The coach could not reply.')
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') { buffer = ''; break }
          let parsed: { text?: string; error?: string }
          try { parsed = JSON.parse(raw) } catch { continue }
          if (parsed.error) throw new Error(parsed.error)
          if (parsed.text) {
            streamTextRef.current += parsed.text
            setStreaming(streamTextRef.current)
            speakNewlyComplete(false)
          }
        }
      }

      // Finalise the assistant turn.
      const finalText = streamTextRef.current.trim()
      streamActiveRef.current = false
      speakNewlyComplete(true)
      if (finalText) setMessages((m) => [...m, { role: 'assistant', content: finalText }])
      setStreaming('')
      busyRef.current = false
      if (speakingCountRef.current === 0) goIdle()
    } catch (e) {
      streamActiveRef.current = false
      busyRef.current = false
      setStreaming('')
      setPhase('idle')
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }, [negotiationId, speakNewlyComplete, goIdle])

  // Keep the ref-routed callbacks pointing at the latest closures.
  sendRef.current = send
  startListeningRef.current = startListening

  // ---- UI handlers -------------------------------------------------------

  const onOrbClick = () => {
    if (!canCoach) return
    if (phase === 'listening') { stopListening(true); return }
    if (phase === 'speaking') { stopSpeaking(); setPhase('idle'); return }
    if (phase === 'thinking') return
    startListening()
  }

  const submitText = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) send(input)
  }

  const statusLabel =
    phase === 'listening' ? 'Listening…'
    : phase === 'thinking' ? 'Thinking…'
    : phase === 'speaking' ? 'Speaking…'
    : 'Tap to talk'

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      <style>{orbStyles}</style>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eceae5] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-black p-1.5 text-white"><Sparkles size={14} /></div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Coaching conversation</p>
            <p className="text-[11px] text-gray-400">Every answer is grounded in the TRC knowledge documents, your Report Card and the transcript</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {mode === 'voice' && (
            <>
              <ToggleChip active={handsFree} onClick={() => setHandsFree((v) => !v)} title="Keep the mic open between turns">
                <Radio size={13} /> Hands-free
              </ToggleChip>
              <IconToggle active={!muted} onClick={() => { const next = !muted; setMuted(next); if (next) stopSpeaking() }} title={muted ? 'Unmute the coach' : 'Mute the coach'}>
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </IconToggle>
            </>
          )}
          <ToggleChip
            active={mode === 'voice'}
            onClick={() => { setMode((m) => (m === 'voice' ? 'text' : 'voice')); stopEverything() }}
            title={sttSupported ? 'Talk to the coach and hear it reply (experimental)' : 'Voice needs a browser with speech recognition'}
            disabled={!sttSupported}
          >
            <Mic size={13} /> Voice <span className="rounded bg-white/20 px-1 text-[9px] uppercase tracking-wider opacity-80">experimental</span>
          </ToggleChip>
        </div>
      </div>

      {/* What the coach has read */}
      {context && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eceae5] bg-[#faf9f7] px-5 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Coach has read</span>
          <ContextChip ok={context.hasReportCard}>Report Card</ContextChip>
          <ContextChip ok={context.transcriptWords > 0}>Transcript{context.transcriptWords > 0 ? ` · ${context.transcriptWords.toLocaleString()} words` : ''}</ContextChip>
          <ContextChip ok>TRC Project Prompt · Manual · Method · Examples</ContextChip>
        </div>
      )}

      {/* Transcript */}
      <div
        ref={scroll.ref}
        onScroll={scroll.onScroll}
        onWheel={scroll.onWheel}
        className="min-h-[420px] max-h-[62vh] overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 && !streaming && (
          <div className="mx-auto max-w-xl py-6 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f2f1ec] text-gray-500"><MessageSquare size={20} /></div>
            <p className="text-sm leading-6 text-gray-600">{greeting || FALLBACK_GREETING}</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {(starters && starters.length > 0 ? starters : FALLBACK_STARTERS).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => send(s.prompt)}
                  disabled={!canCoach || phase === 'thinking'}
                  className="rounded-xl border border-[#e5e3df] bg-white px-4 py-3 text-left text-xs leading-5 text-gray-700 transition-colors hover:border-[#c8973f]/50 hover:bg-[#fcfbf8] disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)}
          {streaming && <Bubble role="assistant" content={streaming} streaming />}
          {phase === 'thinking' && !streaming && (
            <div className="flex justify-start"><div className="rounded-2xl border border-[#e9e7e2] bg-[#f7f6f3] px-4 py-2.5 text-sm text-gray-400">Thinking…</div></div>
          )}
        </div>
      </div>

      {/* Dock */}
      <div className="border-t border-[#eceae5] bg-[#faf9f7] px-5 py-4">
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {mode === 'voice' ? (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={onOrbClick}
              disabled={!canCoach || phase === 'thinking'}
              aria-label={statusLabel}
              className={`sc-orb sc-orb-${phase} relative flex h-20 w-20 items-center justify-center rounded-full text-white transition-transform disabled:cursor-not-allowed`}
            >
              {phase === 'listening' ? <Square size={22} className="relative z-10" fill="currentColor" />
                : phase === 'speaking' ? <AudioLines size={26} className="relative z-10" />
                : <Mic size={26} className="relative z-10" />}
            </button>
            <div className="min-h-[20px] text-center">
              {phase === 'listening' && interim
                ? <p className="max-w-md text-sm text-gray-700">{interim}</p>
                : <p className="text-xs font-medium uppercase tracking-widest text-gray-400">{statusLabel}</p>}
            </div>
            <p className="text-center text-[11px] text-gray-400">Voice is experimental. Switch back to typing any time.</p>
          </div>
        ) : (
          <form onSubmit={submitText} className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) send(input) } }}
              placeholder={canCoach ? 'Ask the coach anything about this negotiation… (Enter to send, Shift+Enter for a new line)' : 'Coaching opens once the Report Card exists.'}
              disabled={!canCoach || phase === 'thinking'}
              rows={2}
              className="max-h-40 min-h-[56px] flex-1 resize-none rounded-xl border border-[#e5e3df] bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-400 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!canCoach || !input.trim() || phase === 'thinking'}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-black text-white transition-colors hover:bg-gray-900 disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function ContextChip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-white text-gray-700 ring-1 ring-[#e5e3df]' : 'bg-stone-100 text-stone-400'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-stone-300'}`} />{children}
    </span>
  )
}

function Bubble({ role, content, streaming }: { role: 'user' | 'assistant'; content: string; streaming?: boolean }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-6 ${
          isUser ? 'bg-black text-white' : 'border border-[#e9e7e2] bg-[#f7f6f3] text-gray-800'
        }`}
      >
        {content}
        {streaming && <span className="sc-caret" />}
      </div>
    </div>
  )
}

function IconToggle({ active, onClick, title, disabled, children }: { active: boolean; onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-30 ${
        active ? 'border-gray-800 bg-gray-900 text-white' : 'border-[#e5e3df] bg-white text-gray-500 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  )
}

function ToggleChip({ active, onClick, title, disabled, children }: { active: boolean; onClick: () => void; title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-30 ${
        active ? 'border-gray-800 bg-gray-900 text-white' : 'border-[#e5e3df] bg-white text-gray-500 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  )
}

// Scoped animations for the voice orb + streaming caret.
const orbStyles = `
.sc-orb { background: radial-gradient(circle at 30% 25%, #3a3a3a, #000 70%); box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.sc-orb::before, .sc-orb::after { content: ''; position: absolute; inset: 0; border-radius: 9999px; }
.sc-orb-idle { animation: sc-breathe 3.6s ease-in-out infinite; }
.sc-orb-thinking::before { border: 2px solid rgba(0,0,0,.15); border-top-color: rgba(0,0,0,.55); animation: sc-spin .9s linear infinite; }
.sc-orb-listening { animation: sc-breathe 1.6s ease-in-out infinite; }
.sc-orb-listening::before { box-shadow: 0 0 0 0 rgba(30,30,30,.35); animation: sc-ping 1.5s cubic-bezier(0,0,.2,1) infinite; }
.sc-orb-listening::after { box-shadow: 0 0 0 0 rgba(30,30,30,.25); animation: sc-ping 1.5s cubic-bezier(0,0,.2,1) infinite .5s; }
.sc-orb-speaking::before { box-shadow: 0 0 0 0 rgba(30,30,30,.30); animation: sc-ping 1.1s cubic-bezier(0,0,.2,1) infinite; }
.sc-orb-speaking::after { box-shadow: 0 0 0 0 rgba(30,30,30,.22); animation: sc-ping 1.1s cubic-bezier(0,0,.2,1) infinite .4s; }
@keyframes sc-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes sc-spin { to { transform: rotate(360deg); } }
@keyframes sc-ping { 0% { box-shadow: 0 0 0 0 rgba(30,30,30,.35); } 70% { box-shadow: 0 0 0 22px rgba(30,30,30,0); } 100% { box-shadow: 0 0 0 22px rgba(30,30,30,0); } }
.sc-caret { display:inline-block; width:7px; height:14px; margin-left:2px; vertical-align:-2px; background:#9ca3af; border-radius:1px; animation: sc-blink 1s steps(2) infinite; }
@keyframes sc-blink { 0%,100%{opacity:1;} 50%{opacity:0;} }
@media (prefers-reduced-motion: reduce) { .sc-orb, .sc-orb::before, .sc-orb::after, .sc-caret { animation: none !important; } }
`
