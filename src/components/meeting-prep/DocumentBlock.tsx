'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { marked } from 'marked'
import { Pencil, WandSparkles, Undo2 } from 'lucide-react'
import Textarea from '@/components/ui/Textarea'

marked.use({ gfm: true, breaks: true })

// Sources open in a new tab, so checking one never loses the document.
export function renderMarkdown(md: string): string {
  return (marked.parse(md) as string).replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=')
}

// The frame every block of the meeting prep document sits in: a numbered
// title, optional header actions, and an anchor for the section nav.
export function BlockShell({
  id, number, title, subtitle, headerRight, children, tone = 'default',
}: {
  id: string
  number?: number | string
  title: string
  subtitle?: ReactNode
  headerRight?: ReactNode
  children: ReactNode
  tone?: 'default' | 'gold'
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 rounded-2xl border bg-white p-5 shadow-sm sm:p-6 ${tone === 'gold' ? 'border-[#c8973f]/35' : 'border-[#e5e3df]'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {number !== undefined && (
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">
              {number}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-gray-900">{title}</h2>
            {subtitle && <p className="mt-1 text-xs leading-snug text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {headerRight && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{headerRight}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

// Placeholder for a block that hasn't been written yet: shimmering lines
// while it's being written, a quiet note while it waits its turn.
export function BlockPlaceholder({ writing, label }: { writing: boolean; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-dashed border-[#e5e3df] bg-[#faf9f7] p-4">
      <p className={`text-xs ${writing ? 'font-medium text-gray-700' : 'text-gray-400'}`}>{label}</p>
      <div className="mt-3 space-y-2" aria-hidden>
        <div className="h-2.5 w-11/12 rounded bg-[#ebe9e4]" />
        <div className="h-2.5 w-4/5 rounded bg-[#ebe9e4]" />
        <div className="h-2.5 w-3/5 rounded bg-[#ebe9e4]" />
      </div>
      {writing && <div className="content-shimmer absolute inset-0" />}
    </div>
  )
}

export function ActionButton({ onClick, disabled, children, title }: { onClick: () => void; disabled?: boolean; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e3df] bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
    >
      {children}
    </button>
  )
}

// "What should change?" box shared by every Regenerate.
export function RegeneratePanel({
  label = 'What should change? (optional)', placeholder, hint, busy, submitLabel = 'Regenerate', onSubmit, onCancel,
}: {
  label?: string
  placeholder?: string
  hint?: ReactNode
  busy: boolean
  submitLabel?: string
  onSubmit: (feedback: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="mt-3 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-4">
      <Textarea
        ref={ref}
        label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        disabled={busy}
      />
      {hint && <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{hint}</p>}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit(text)}
          className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Working…' : submitLabel}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  )
}

// A block whose content is one markdown text: shows it, and offers Edit,
// Regenerate (with an optional note) and Undo of the last regenerate.
export default function MarkdownBlock({
  id, number, title, subtitle, headerRight, text, placeholder, disabled, busy,
  canUndo, onSave, onRegenerate, onUndo, regeneratePlaceholder, regenerateHint, regenerateLabel = 'Regenerate', emptyAction,
}: {
  id: string
  number?: number
  title: string
  subtitle?: ReactNode
  headerRight?: ReactNode
  text: string
  // Shown instead of the text while it doesn't exist yet.
  placeholder?: ReactNode
  disabled: boolean
  busy: boolean
  canUndo: boolean
  onSave: (text: string) => Promise<void> | void
  onRegenerate: (feedback: string) => Promise<void> | void
  onUndo: () => void
  regeneratePlaceholder?: string
  regenerateHint?: ReactNode
  regenerateLabel?: string
  // Label for the button that writes a missing block.
  emptyAction?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [askFeedback, setAskFeedback] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing || !textareaRef.current) return
    const el = textareaRef.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  // Close the note box once the regenerate it started has finished.
  const wasBusy = useRef(busy)
  useEffect(() => {
    if (wasBusy.current && !busy) setAskFeedback(false)
    wasBusy.current = busy
  }, [busy])

  const hasText = Boolean(text.trim())

  return (
    <BlockShell id={id} number={number} title={title} subtitle={subtitle} headerRight={headerRight}>
      {!hasText && placeholder ? (
        placeholder
      ) : busy ? (
        // Same height in, same height out: the text stays (dimmed) while it's
        // rewritten, so nothing below jumps.
        <div className="relative overflow-hidden rounded-lg">
          <div className="prose-research pointer-events-none select-none text-sm text-gray-800 opacity-25" dangerouslySetInnerHTML={{ __html: renderMarkdown(text || '_Writing…_') }} />
          <div className="content-shimmer absolute inset-0" />
        </div>
      ) : editing ? (
        <div>
          <Textarea ref={textareaRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} className="text-sm" label="" />
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={async () => { await onSave(draft); setEditing(false) }}
              className="rounded-lg bg-black px-4 py-2 text-xs font-medium text-white hover:bg-gray-900"
            >
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 text-xs font-medium text-gray-500 hover:text-gray-900">Cancel</button>
          </div>
        </div>
      ) : hasText ? (
        <div className="prose-research text-sm text-gray-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
      ) : (
        <p className="text-sm text-gray-400">This section is empty.</p>
      )}

      {!editing && (hasText || emptyAction) && !(placeholder && !hasText) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f0eee9] pt-3">
          {hasText && (
            <ActionButton disabled={disabled || busy} onClick={() => { setDraft(text); setEditing(true); setAskFeedback(false) }}>
              <Pencil size={13} /> Edit
            </ActionButton>
          )}
          <ActionButton disabled={disabled || busy} onClick={() => setAskFeedback((v) => !v)}>
            <WandSparkles size={13} className={busy ? 'animate-pulse' : ''} />
            {busy ? 'Working…' : hasText ? regenerateLabel : emptyAction}
          </ActionButton>
          {canUndo && !busy && (
            <button type="button" disabled={disabled} onClick={onUndo} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40">
              <Undo2 size={13} /> Undo last regenerate
            </button>
          )}
        </div>
      )}

      {askFeedback && !editing && (
        <RegeneratePanel
          busy={busy}
          placeholder={regeneratePlaceholder}
          hint={regenerateHint}
          submitLabel={hasText ? regenerateLabel : emptyAction || 'Write it'}
          onSubmit={(fb) => onRegenerate(fb)}
          onCancel={() => setAskFeedback(false)}
        />
      )}
    </BlockShell>
  )
}
