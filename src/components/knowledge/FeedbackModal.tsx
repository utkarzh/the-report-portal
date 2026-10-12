'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, FilePlus2, Lightbulb, Link2, MessageSquareWarning, Paperclip, ThumbsUp, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { KNOWLEDGE_BUCKET, RATING_LABELS } from '@/lib/knowledge/constants'
import type { KnowledgeRating } from '@/types'

export type FeedbackTarget =
  | { mode: 'rating'; messageId: string; rating: KnowledgeRating }
  | { mode: 'suggest-change'; messageId?: string; itemId?: string; itemTitle?: string; departmentId?: string }
  | { mode: 'suggest-new'; departmentId?: string }

interface Props {
  target: FeedbackTarget | null
  // The user's departments, for routing when nothing else names one.
  departments: { id: string; name: string }[]
  onClose: () => void
  onSubmitted?: (target: FeedbackTarget) => void
}

const RATING_HINTS: Partial<Record<KnowledgeRating, string>> = {
  unclear: 'What was confusing? The Guardian can reword the source.',
  incorrect: 'What’s wrong, and what’s actually correct?',
  outdated: 'What has changed since this was written?',
  missing: 'What were you hoping to find? The Guardian decides what to add.',
}

// One modal for every kind of feedback: a rating with an optional comment
// (US-115) and a change / new-knowledge suggestion with an optional link or
// file (US-116).
export default function FeedbackModal({ target, departments, onClose, onSubmitted }: Props) {
  const [comment, setComment] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [departmentId, setDepartmentId] = useState('')
  const [needsDepartment, setNeedsDepartment] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setComment('')
    setLinkUrl('')
    setFile(null)
    setError(null)
    setDone(false)
    setNeedsDepartment(target?.mode === 'suggest-new' && !target.departmentId && departments.length > 1)
    setDepartmentId(target?.mode === 'suggest-new' && target.departmentId ? target.departmentId : departments.length === 1 ? departments[0].id : '')
  }, [target, departments])

  if (!target) return null
  const isSuggestion = target.mode !== 'rating'
  const title =
    target.mode === 'rating'
      ? target.rating === 'missing'
        ? 'Send this gap to the Guardian'
        : target.rating === 'helpful'
          ? 'Glad it helped'
          : `Report: ${RATING_LABELS[target.rating].toLowerCase()}`
      : target.mode === 'suggest-change'
        ? 'Suggest a change'
        : 'Suggest new knowledge'
  const Icon =
    target.mode === 'rating' ? (target.rating === 'helpful' ? ThumbsUp : MessageSquareWarning) : target.mode === 'suggest-new' ? FilePlus2 : Lightbulb

  async function submit() {
    setError(null)
    if (isSuggestion && !comment.trim()) {
      setError('Describe your suggestion first.')
      return
    }
    if (needsDepartment && !departmentId) {
      setError('Choose a department.')
      return
    }
    setBusy(true)
    try {
      let attachment: { path: string; name: string } | undefined
      if (isSuggestion && file) {
        const deptForUpload = (target && target.mode !== 'rating' ? target.departmentId : undefined) || departmentId
        const urlRes = await fetch('/api/knowledge/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ departmentId: deptForUpload || departments[0]?.id, filename: file.name, size: file.size, purpose: 'suggestion' }),
        })
        const urlData = await urlRes.json()
        if (!urlRes.ok) throw new Error(urlData.error || 'Could not upload the file')
        const supabase = getSupabaseBrowserClient()
        const { error: upErr } = await supabase.storage.from(KNOWLEDGE_BUCKET).uploadToSignedUrl(urlData.path, urlData.token, file)
        if (upErr) throw new Error(upErr.message)
        attachment = { path: urlData.path, name: file.name }
      }

      const payload =
        target!.mode === 'rating'
          ? { kind: 'feedback', rating: target!.rating, messageId: target!.messageId, comment, departmentId: departmentId || undefined }
          : {
              kind: 'suggestion',
              suggestionType: target!.mode === 'suggest-new' ? 'new' : 'change',
              messageId: target!.mode === 'suggest-change' ? target!.messageId : undefined,
              itemId: target!.mode === 'suggest-change' ? target!.itemId : undefined,
              departmentId: departmentId || undefined,
              comment,
              linkUrl: linkUrl.trim() || undefined,
              attachment,
            }
      const res = await fetch('/api/knowledge/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data.needsDepartment) setNeedsDepartment(true)
        throw new Error(data.error || 'Could not send that. Please try again.')
      }
      setDone(true)
      onSubmitted?.(target!)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="modal-backdrop-in absolute inset-0 bg-black/40" onClick={busy ? undefined : onClose} />
      <div className="modal-panel-in relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
          <X size={16} />
        </button>

        {done ? (
          <div className="px-6 pb-6 pt-8 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={22} />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-gray-900">
              {target.mode === 'rating' && target.rating === 'helpful' ? 'Thanks — glad it helped' : 'Sent to the Guardian'}
            </h3>
            <p className="mx-auto mt-1.5 max-w-xs text-xs leading-5 text-gray-500">
              {target.mode === 'rating' && target.rating === 'helpful'
                ? 'Your rating helps the Guardians see what’s working.'
                : 'Nothing changes until they review it. You can follow what happens under My suggestions.'}
            </p>
            <div className="mt-5">
              <Button size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-[#eceae5] px-6 pb-4 pt-6 pr-12">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#fbf7ed] text-[#a07530]">
                <Icon size={17} />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">
                  {isSuggestion
                    ? 'Tell the Guardian what should change or be added. They review every suggestion and decide what to update.'
                    : target.rating === 'helpful'
                      ? 'Anything to add? (optional)'
                      : RATING_HINTS[target.rating] ?? 'Add a short comment so the Guardian knows what to fix (optional).'}
                </p>
                {target.mode === 'suggest-change' && target.itemTitle && (
                  <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f7f6f3] px-2.5 py-1 text-[11px] text-gray-600">
                    About <span className="truncate font-medium text-gray-800">{target.itemTitle}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-5">
              {needsDepartment && (
                <label className="mb-4 block">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Department</span>
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
                  >
                    <option value="">Choose which department this is for…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={isSuggestion ? 5 : 3}
                maxLength={4000}
                autoFocus
                placeholder={isSuggestion ? 'e.g. The interview outline guide still says two pages — it’s one page now.' : 'Optional comment'}
                className="w-full resize-y rounded-xl border border-[#e5e3df] p-3 text-sm leading-relaxed placeholder:text-gray-400 focus:border-black focus:outline-none"
              />

              {isSuggestion && (
                <div className="mt-3 flex flex-col gap-2.5">
                  <div className="relative">
                    <Link2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="Link to a source (optional) — https://…"
                      className="w-full rounded-lg border border-[#e5e3df] py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#d9d5cc] px-3 py-2.5 text-xs text-gray-600 transition-colors hover:border-gray-400 hover:text-black">
                    <Paperclip size={14} className="flex-shrink-0" />
                    <span className="truncate">{file ? file.name : 'Attach a file (optional) — e.g. the updated document'}</span>
                    {file && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          setFile(null)
                        }}
                        className="ml-auto text-gray-400 hover:text-gray-700"
                        aria-label="Remove file"
                      >
                        <X size={13} />
                      </button>
                    )}
                    <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </label>
                </div>
              )}

              {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
            </div>

            <div className="flex gap-3 border-t border-[#eceae5] bg-[#fcfbf9] px-6 py-4">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy} className="flex-1 justify-center">
                Cancel
              </Button>
              <Button size="sm" onClick={submit} loading={busy} className="flex-1 justify-center">
                {isSuggestion || (target.mode === 'rating' && target.rating !== 'helpful') ? 'Send to Guardian' : 'Send'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
