'use client'

import { useEffect, useRef, useState } from 'react'
import { WandSparkles, Undo2, Headphones, Hand, FileDown, CheckCircle2, RotateCcw, Lightbulb } from 'lucide-react'
import AudioPlayer from '@/components/transcriptions/AudioPlayer'
import { BlockShell, ActionButton, RegeneratePanel, renderMarkdown } from '@/components/meeting-prep/DocumentBlock'
import { splitPlanteoOutput, SPOKEN_PLANTEO_MARKER } from '@/lib/meeting-prep'
import {
  DELIVER_SCRIPT_TITLE, parseScript, spokenParts, scriptResourceLabel, usesVerbatimScript,
  type ScriptResource, type ScriptSegment,
} from '@/lib/meeting-prep-document'
import type { InterviewType } from '@/types'

// A spoken line: the words in bold italics, "(message 2 …)" gaps the rep
// fills in from the interview highlighted, "(HAND IT OVER …)" actions as
// tags — so it's obvious what is said and what is done.
function SpokenLine({ text }: { text: string }) {
  return (
    <p className="text-[15px] font-bold italic leading-relaxed text-gray-900">
      {spokenParts(text).map((part, i) =>
        part.kind === 'gap' ? (
          <span key={i} className="rounded bg-amber-200/70 px-1 font-semibold text-amber-950" title="Fill this in from the interview">
            {part.text}
          </span>
        ) : part.kind === 'action' ? (
          <span key={i} className="mx-0.5 inline-flex items-center gap-1 rounded bg-gray-900 px-1.5 py-0.5 align-middle text-[10px] font-semibold not-italic uppercase tracking-wide text-white">
            <Hand size={10} /> {part.text.replace(/^\(|\)$/g, '')}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  )
}

function Direction({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-white px-3 py-2.5 ring-1 ring-black/10">
      <Hand size={14} className="mt-0.5 flex-shrink-0 text-[#a07530]" />
      <p className="text-[13px] font-bold leading-snug text-gray-900">{text}</p>
    </div>
  )
}

function ScriptView({ segments }: { segments: ScriptSegment[] }) {
  return (
    <div className="flex flex-col gap-3.5">
      {segments.map((seg, i) =>
        seg.kind === 'spoken' ? (
          <SpokenLine key={i} text={seg.text} />
        ) : seg.kind === 'direction' ? (
          <Direction key={i} text={seg.text} />
        ) : seg.kind === 'note' ? (
          // The script's own footnote, with its asterisk ("message* 1").
          <p key={i} className="text-xs leading-relaxed text-gray-500">*{seg.text}</p>
        ) : null,
      )}
    </div>
  )
}

export default function PlanteoBlock({
  id, number, title, type, planteoOutput, librarySnapshot, recordingUrl, samples,
  disabled, busy, canUndo, onSaveOutput, onRegenerate, onUndo,
}: {
  id: string
  number: number
  title: string
  type: InterviewType
  planteoOutput: string
  librarySnapshot: string | null
  recordingUrl: string | null
  samples: Record<ScriptResource, boolean>
  disabled: boolean
  busy: boolean
  canUndo: boolean
  onSaveOutput: (planteoOutput: string) => Promise<void> | void
  onRegenerate: (feedback: string) => Promise<void> | void
  onUndo: () => void
}) {
  const { recommendation: notes, script } = splitPlanteoOutput(planteoOutput)
  const segments = parseScript(script)
  const verbatim = usesVerbatimScript(type, segments)
  // A sample file only shows once an admin has uploaded it under Admin →
  // Apertura sample files. Until then there's nothing to show here.
  const downloads = segments.filter((s) => s.kind === 'download' && s.resource && samples[s.resource])
  const tips = segments.filter((s) => s.kind === 'tip')

  const [asking, setAsking] = useState(false)
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) setAsking(false)
    wasBusy.current = busy
  }, [busy])

  // Nobody hand-edits the pitch (5 Nov 2026: "It is what it is"). Older meetings
  // edited before that can still be put back to the approved script. The CEO
  // recommendation ahead of the marker isn't shown here (the CEO, Nov 2026: it
  // "may cause confusion" with the three points), but Block 1's recommended
  // pitch is built from it, so it's kept.
  function joinScript(newScript: string): string {
    return notes ? `${notes}\n\n${SPOKEN_PLANTEO_MARKER}\n\n${newScript.trim()}` : newScript.trim()
  }
  const approved = (librarySnapshot || '').trim()
  const edited = verbatim && approved && script.trim() !== approved

  // A fixed script is never rewritten by the model: there is nothing to
  // regenerate. Changing the CEO's offer is done from Block 1.
  const canRegenerate = !verbatim

  return (
    <BlockShell id={id} number={number} title={title} tone="gold">
      {verbatim ? (
        <div className="rounded-xl border-l-4 border-[#c8973f] bg-[#fbf7ed] p-5">
          <p className="text-sm font-extrabold uppercase tracking-wide text-gray-900">{DELIVER_SCRIPT_TITLE}</p>
          <p className="mb-4 mt-1 text-xs leading-relaxed text-gray-600">
            Say these words exactly as written. <span className="rounded bg-amber-200/70 px-1 font-medium text-amber-950">Highlighted brackets</span> are what you fill in from the interview; the lines marked with a hand are what you do.
          </p>
          <ScriptView segments={segments} />
        </div>
      ) : (
        // The Government Official planteo is the model's own write-up: shown
        // as written, as before.
        <div className="relative overflow-hidden rounded-lg">
          <div className={`prose-research text-sm text-gray-800 ${busy ? 'pointer-events-none select-none opacity-25' : ''}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(script || '_Not written yet._') }} />
          {busy && <div className="content-shimmer absolute inset-0" />}
        </div>
      )}

      {/* The reference recording lives here and only here (client request), and
          only for CEO meetings: the page passes no URL for any other type. */}
      {recordingUrl && (
        <div className="mt-4 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-4">
          <div className="flex items-start gap-2.5">
            <Headphones size={15} className="mt-0.5 flex-shrink-0 text-gray-600" />
            <div>
              <p className="text-xs font-semibold text-gray-900">Listen: how a planteo is delivered</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">A reference recording. Listen to it before the meeting, then deliver the script above the same way.</p>
            </div>
          </div>
          <AudioPlayer src={recordingUrl} />
        </div>
      )}

      {downloads.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {downloads.map((d, i) => {
            const r = d.resource!
            return (
              <a
                key={i}
                href={`/api/meeting-prep/resources/${r}/download`}
                className="group flex items-center gap-3 rounded-xl border border-[#e5e3df] bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:shadow"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#c8973f]/10 text-[#a07530]"><FileDown size={16} /></span>
                <span>
                  <span className="block text-xs font-semibold text-gray-900">{scriptResourceLabel(r)}</span>
                  <span className="block text-[11px] text-gray-500">Download</span>
                </span>
              </a>
            )
          })}
        </div>
      )}

      {tips.length > 0 && (
        <div className="mt-4 rounded-xl border border-[#e5e3df] bg-white p-4">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-500"><Lightbulb size={13} className="text-[#c8973f]" /> Notes and tips</p>
          <ul className="flex flex-col gap-2.5">
            {tips.map((t, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-gray-700">
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(canRegenerate || edited) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f0eee9] pt-3">
          {canRegenerate && (
            <ActionButton disabled={disabled || busy} onClick={() => setAsking((v) => !v)}>
              <WandSparkles size={13} className={busy ? 'animate-pulse' : ''} />
              {busy ? 'Working…' : 'Regenerate'}
            </ActionButton>
          )}
          {edited && (
            <ActionButton disabled={disabled || busy} onClick={() => onSaveOutput(joinScript(approved))} title="Put back the script exactly as approved in the Planteo Library">
              <RotateCcw size={13} /> Restore the approved script
            </ActionButton>
          )}
          {canUndo && canRegenerate && !busy && (
            <button type="button" disabled={disabled} onClick={onUndo} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800">
              <Undo2 size={13} /> Undo last regenerate
            </button>
          )}
        </div>
      )}

      {asking && (
        <RegeneratePanel
          busy={busy}
          placeholder="e.g. Tighten the opening paragraph. Lean more on the investment-attraction angle."
          onSubmit={(fb) => onRegenerate(fb)}
          onCancel={() => setAsking(false)}
        />
      )}
    </BlockShell>
  )
}
