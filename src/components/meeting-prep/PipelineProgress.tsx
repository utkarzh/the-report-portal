'use client'

import { Check, Loader2, AlertTriangle, Sparkles } from 'lucide-react'

export type StepState = 'done' | 'running' | 'waiting' | 'failed'

export interface PipelineStep {
  key: string
  label: string
  state: StepState
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

// The one progress card for the whole run: research → points → planteo →
// document (→ apertura list & letter, in parallel). Everything else on the
// page fills in below it as each part lands, so there is no "wait, then
// click" between steps (client request: "too many clicks … too much waiting").
export default function PipelineProgress({
  steps, status, elapsedSecs, running,
}: {
  steps: PipelineStep[]
  status: string
  elapsedSecs: number
  running: boolean
}) {
  const done = steps.filter((s) => s.state === 'done').length
  const pct = Math.round((done / steps.length) * 100)
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e3df] bg-white shadow-sm">
      <div className="flex items-start gap-4 p-5">
        <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center">
          {running && <div className="gemini-aurora absolute -inset-1 rounded-full opacity-60 blur-md" />}
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-gray-900 to-gray-800 shadow ring-1 ring-white/10">
            <Sparkles size={17} className={`text-white ${running ? 'gemini-sparkle' : ''}`} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">{running ? 'Writing your meeting prep' : 'Meeting prep paused'}</p>
            {running && <p className="text-[11px] font-medium tabular-nums text-gray-400">{fmt(elapsedSecs)} elapsed</p>}
          </div>
          <p key={status} className="fade-up mt-0.5 text-xs text-gray-600">{status}</p>
          {running && (
            <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
              Usually 3–5 minutes. Keep this tab open: each part appears below as soon as it&apos;s ready, and you can start reading straight away.
            </p>
          )}
        </div>
      </div>
      <div className="h-1 w-full bg-[#f0eee9]">
        <div className="h-1 bg-[#c8973f] transition-all duration-700" style={{ width: `${Math.max(pct, running ? 4 : 0)}%` }} />
      </div>
      <ol className="flex flex-wrap gap-x-5 gap-y-2 px-5 py-3">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full ${
                s.state === 'done'
                  ? 'bg-emerald-100 text-emerald-700'
                  : s.state === 'running'
                    ? 'bg-[#c8973f]/15 text-[#a07530]'
                    : s.state === 'failed'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-gray-100 text-gray-300'
              }`}
            >
              {s.state === 'done' ? <Check size={10} /> : s.state === 'running' ? <Loader2 size={10} className="animate-spin" /> : s.state === 'failed' ? <AlertTriangle size={9} /> : <span className="h-1 w-1 rounded-full bg-current" />}
            </span>
            <span className={s.state === 'waiting' ? 'text-gray-400' : s.state === 'failed' ? 'text-red-600' : 'font-medium text-gray-700'}>{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
