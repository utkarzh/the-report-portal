'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pencil, WandSparkles, Undo2 } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'
import { BlockShell, ActionButton, RegeneratePanel } from '@/components/meeting-prep/DocumentBlock'

// Section 5: the three presentation points. Each point can be edited or
// regenerated on its own, or all three reframed together (US-028).
export default function PointsBlock({
  id, number, title, points, placeholder, disabled, busy, pointUndo, allUndo,
  onSave, onRegenerate, onUndoPoint, onUndoAll,
}: {
  id: string
  number: number
  title: string
  points: string[]
  placeholder?: ReactNode
  disabled: boolean
  busy: number | 'all' | null
  pointUndo: Partial<Record<number, string>>
  allUndo: string[] | null
  onSave: (index: number, text: string) => Promise<void> | void
  onRegenerate: (target: number | 'all', feedback: string) => Promise<void> | void
  onUndoPoint: (index: number) => void
  onUndoAll: () => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState<number | 'all' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing === null || !textareaRef.current) return
    const el = textareaRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current !== null && busy === null) setAsking(null)
    wasBusy.current = busy
  }, [busy])

  return (
    <BlockShell id={id} number={number} title={title} subtitle="Written to be said aloud, in your own words.">
      {points.length === 0 && placeholder ? (
        placeholder
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {points.map((point, i) => {
              const isBusy = busy === i || busy === 'all'
              const isEditing = editing === i
              return (
                <div key={i} className={`rounded-xl border p-4 transition-colors ${isEditing ? 'border-black/15 bg-white' : 'border-[#ece9e3] bg-[#faf9f7]'}`}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#c8973f] text-[11px] font-semibold text-white">{i + 1}</span>
                    {isBusy ? (
                      <div className="relative flex-1 overflow-hidden rounded-lg">
                        <p className="pointer-events-none select-none text-sm leading-relaxed text-gray-800 opacity-25">{point}</p>
                        <div className="content-shimmer absolute inset-0" />
                      </div>
                    ) : isEditing ? (
                      <div className="flex-1">
                        <Textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="text-sm" label="" />
                        <div className="mt-2 flex gap-3">
                          <button type="button" onClick={async () => { await onSave(i, draft); setEditing(null) }} className="rounded-lg bg-black px-3 py-1.5 touch:py-2.5 text-xs font-medium text-white hover:bg-gray-900">Save</button>
                          <button type="button" onClick={() => setEditing(null)} className="px-3 py-1.5 touch:py-2.5 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p className="flex-1 text-sm leading-relaxed text-gray-800">{point}</p>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="ml-9 mt-2 flex flex-wrap items-center gap-2">
                      <ActionButton disabled={disabled || busy !== null} onClick={() => { setEditing(i); setDraft(point); setAsking(null) }}>
                        <Pencil size={13} /> Edit
                      </ActionButton>
                      <ActionButton disabled={disabled || busy !== null} onClick={() => setAsking(asking === i ? null : i)}>
                        <WandSparkles size={13} className={busy === i ? 'animate-pulse' : ''} /> {busy === i ? 'Working…' : 'Regenerate'}
                      </ActionButton>
                      {pointUndo[i] !== undefined && busy === null && (
                        <button type="button" disabled={disabled} onClick={() => onUndoPoint(i)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                          <Undo2 size={13} /> Undo
                        </button>
                      )}
                    </div>
                  )}

                  {asking === i && (
                    <div className="ml-9">
                      <RegeneratePanel
                        busy={busy === i}
                        placeholder="e.g. Lean on their export growth instead."
                        onSubmit={(fb) => onRegenerate(i, fb)}
                        onCancel={() => setAsking(null)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f0eee9] pt-3">
            <ActionButton disabled={disabled || busy !== null || points.length === 0} onClick={() => setAsking(asking === 'all' ? null : 'all')}>
              <WandSparkles size={13} className={busy === 'all' ? 'animate-pulse' : ''} /> {busy === 'all' ? 'Working…' : 'Reframe all three'}
            </ActionButton>
            {allUndo && busy === null && (
              <button type="button" disabled={disabled} onClick={onUndoAll} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 touch:py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800">
                <Undo2 size={13} /> Undo last reframe
              </button>
            )}
          </div>
          {asking === 'all' && (
            <RegeneratePanel
              busy={busy === 'all'}
              label="Reframe all three points"
              placeholder="e.g. Point 1 is fine; make 2 and 3 about their international expansion."
              submitLabel="Reframe"
              onSubmit={(fb) => onRegenerate('all', fb)}
              onCancel={() => setAsking(null)}
            />
          )}
        </>
      )}
    </BlockShell>
  )
}
