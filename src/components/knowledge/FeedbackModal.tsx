'use client'

import { useEffect, useState } from 'react'
import { X, Paperclip } from 'lucide-react'
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
        : `Mark as ${RATING_LABELS[target.rating].toLowerCase()}`
      : target.mode === 'suggest-change'
        ? 'Suggest a change'
        : 'Suggest new knowledge'

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
      <div className="modal-panel-in relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-700" aria-label="Close">
          <X size={16} />
        </button>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>

        {done ? (
          <>
            <p className="mt-3 text-sm text-gray-600">
              {target.mode === 'rating' && target.rating === 'helpful'
                ? 'Thanks — glad it helped.'
                : 'Sent to the department’s Guardian. Nothing changes until they review it — you can follow its status under My suggestions.'}
            </p>
            <div className="mt-5">
              <Button size="sm" onClick={onClose}>Close</Button>
            </div>
          </>
        ) : (
          <>
            {target.mode === 'suggest-change' && target.itemTitle && (
              <p className="mt-2 text-xs text-gray-500">About: <span className="font-medium text-gray-700">{target.itemTitle}</span></p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              {isSuggestion
                ? 'Tell the Guardian what should change or be added. They decide what to update.'
                : target.rating === 'helpful'
                  ? 'Anything to add? (optional)'
                  : 'Add a short comment so the Guardian knows what to fix (optional).'}
            </p>

            {needsDepartment && (
              <label className="mt-4 block">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Department</span>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="mt-1.5 w-full border-b border-gray-300 bg-transparent py-2 text-sm focus:border-black focus:outline-none"
                >
                  <option value="">Choose…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            )}

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={isSuggestion ? 5 : 3}
              maxLength={4000}
              placeholder={isSuggestion ? 'e.g. The interview outline guide still says two pages — it’s one page now.' : 'Optional comment'}
              className="mt-4 w-full resize-y rounded border border-[#e5e3df] p-3 text-sm leading-relaxed placeholder:text-gray-400 focus:border-black focus:outline-none"
            />

            {isSuggestion && (
              <div className="mt-3 flex flex-col gap-3">
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="Link (optional) — https://…"
                  className="border-b border-gray-300 bg-transparent py-2 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none"
                />
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600 hover:text-black">
                  <Paperclip size={14} />
                  {file ? file.name : 'Attach a file (optional)'}
                  <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" size="sm" onClick={onClose} disabled={busy} className="flex-1 justify-center">Cancel</Button>
              <Button size="sm" onClick={submit} loading={busy} className="flex-1 justify-center">Send</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
