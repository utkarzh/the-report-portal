'use client'

import { useState, useEffect } from 'react'
import { X, Paperclip, History, ChevronDown, ChevronUp } from 'lucide-react'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { MAX_FUNDING_ATTACHMENTS } from '@/lib/finance'
import type { SignedAttachment } from '@/lib/finance-attachments'
import RateCheck from '@/components/finance/RateCheck'
import HistoryList from '@/components/finance/HistoryList'
import type { FinanceAttachment, FinanceFunding } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onSent: () => void
  projectId: string
  settlementCurrency: string
  // The project's local currency, offered as a "sent in" option alongside
  // the settlement currency and the usual majors.
  localCurrency?: string | null
  // Present → editing an already-recorded funding (admin-only correction,
  // client request Oct 2026) instead of recording a new one. Prefills every
  // field and PATCHes /api/finance/fundings/[id] on submit. A Director never
  // reaches this prop — the admin project page is the only caller that sets it.
  // Its signed `attachments` (when the caller has them) make the files
  // already on record openable from here.
  editingFunding?: (FinanceFunding & { attachments?: SignedAttachment[] }) | null
}

// The files on record for a funding — proof_files since migration 042, or
// the single proof_image_path on a row from before it.
function recordedFiles(f: FinanceFunding): FinanceAttachment[] {
  if (f.proof_files?.length) return f.proof_files
  return f.proof_image_path ? [{ path: f.proof_image_path, name: 'Evidence' }] : []
}

const CONCEPT_SUGGESTIONS = ['Initial project funds', 'Additional funds', 'Travel budget', 'PR expenses']

export default function SendFundsModal({ open, onClose, onSent, projectId, settlementCurrency, localCurrency, editingFunding }: Props) {
  const isEditing = Boolean(editingFunding)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(settlementCurrency)
  const [exchangeRate, setExchangeRate] = useState('')
  const [dateSent, setDateSent] = useState(() => new Date().toISOString().slice(0, 10))
  const [concept, setConcept] = useState('')
  // Several evidence files per funding (client request, Oct 2026: "I can
  // only upload one file as proof"). keptFiles = already on record (edit),
  // newFiles = chosen in this session, uploaded on submit.
  const [keptFiles, setKeptFiles] = useState<FinanceAttachment[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // Prefill from the funding being edited each time the modal opens for it.
  useEffect(() => {
    if (!open) return
    if (editingFunding) {
      setAmount(String(editingFunding.sent_amount ?? editingFunding.amount))
      setCurrency(editingFunding.sent_currency || settlementCurrency)
      setExchangeRate(editingFunding.exchange_rate != null && editingFunding.exchange_rate !== 1 ? String(editingFunding.exchange_rate) : '')
      setDateSent(editingFunding.date_sent)
      setConcept(editingFunding.concept || '')
      setKeptFiles(recordedFiles(editingFunding))
    } else {
      setAmount(''); setCurrency(settlementCurrency); setExchangeRate('')
      setDateSent(new Date().toISOString().slice(0, 10)); setConcept('')
      setKeptFiles([])
    }
    setNewFiles([])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingFunding?.id])

  const currencyOptions = Array.from(new Set(
    [settlementCurrency, localCurrency, 'USD', 'EUR', 'GBP'].filter((c): c is string => !!c).map(c => c.toUpperCase()),
  ))
  const crossCurrency = currency !== settlementCurrency
  const amountNum = parseFloat(amount)
  const rateNum = parseFloat(exchangeRate)
  const credited = crossCurrency && Number.isFinite(amountNum) && Number.isFinite(rateNum) && rateNum > 0
    ? Math.round(amountNum * rateNum * 100) / 100
    : null

  const totalFiles = keptFiles.length + newFiles.length
  const recordedUrls = new Map((editingFunding?.attachments ?? []).map(a => [a.path, a.url]))

  function addFiles(picked: File[]) {
    if (picked.length === 0) return
    if (totalFiles + picked.length > MAX_FUNDING_ATTACHMENTS) {
      setError(`Up to ${MAX_FUNDING_ATTACHMENTS} files per transfer.`)
      return
    }
    setError(null)
    setNewFiles(prev => [...prev, ...picked])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (crossCurrency && (!Number.isFinite(rateNum) || rateNum <= 0)) {
      setError(`Enter the exchange rate used to convert ${currency} into ${settlementCurrency}.`)
      return
    }
    setLoading(true)

    // Uploaded this time — removed again if the save doesn't go through, so
    // a failed attempt leaves no stray files in storage.
    const supabase = getSupabaseBrowserClient()
    const uploadedPaths: string[] = []
    try {
      // The full list after this save — the files kept plus the new ones.
      // The edit route replaces what's on record with exactly this list (and
      // deletes the stored files of any that were removed).
      // allSettled, so every upload has finished (and is known) before any
      // failure is reported and cleaned up.
      const results = await Promise.allSettled(newFiles.map(async (file) => {
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `${projectId}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('finance-receipts').upload(path, file)
        if (uploadError) throw new Error(`${file.name}: ${uploadError.message}`)
        return { path, name: file.name }
      }))
      const uploaded = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
      uploadedPaths.push(...uploaded.map(u => u.path))
      const failedUpload = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failedUpload) throw failedUpload.reason
      const proofFiles = [...keptFiles, ...uploaded]

      const res = await fetch(
        isEditing ? `/api/finance/fundings/${editingFunding!.id}` : `/api/finance/projects/${projectId}/funding`,
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount,
            currency,
            exchangeRate: crossCurrency ? exchangeRate : undefined,
            dateSent,
            concept: concept.trim() || null,
            proofFiles,
          }),
        },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to ${isEditing ? 'save the changes' : 'record the transfer'}.`)
      }

      onSent()
      onClose()
    } catch (err) {
      if (uploadedPaths.length > 0) await supabase.storage.from('finance-receipts').remove(uploadedPaths).catch(() => {})
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-2xl flex flex-col rounded-xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <h2 className="text-sm font-semibold text-gray-900">{isEditing ? 'Edit funding' : 'Send funds to director'}</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-6 flex flex-col gap-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <Input
              label="Amount sent *"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
            />
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">Currency *</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="border-b border-gray-300 bg-transparent py-2 pr-1 text-sm focus:outline-none focus:border-black transition-colors"
              >
                {currencyOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {crossCurrency && (
            <div>
              <Input
                label={`Exchange rate (${settlementCurrency} per 1 ${currency}) *`}
                type="number"
                step="0.000001"
                min="0"
                value={exchangeRate}
                onChange={e => setExchangeRate(e.target.value)}
                required
              />
              <RateCheck base={currency} quote={settlementCurrency} rate={exchangeRate} onUseRate={r => setExchangeRate(String(r))} />
              <p className="text-xs text-gray-500 mt-1.5">
                {credited != null
                  ? `Credits ${settlementCurrency} ${credited.toFixed(2)} to the project balance.`
                  : `The balance is kept in ${settlementCurrency}, so the amount is converted at this rate.`}
              </p>
            </div>
          )}

          <Input
            label="Date sent *"
            type="date"
            value={dateSent}
            onChange={e => setDateSent(e.target.value)}
            required
          />

          <div>
            <Input
              label="Concept (optional)"
              value={concept}
              maxLength={200}
              placeholder="e.g. Additional funds – September"
              onChange={e => setConcept(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {CONCEPT_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setConcept(s)}
                  className="text-[11px] text-gray-600 border border-[#e5e3df] rounded-full px-2.5 py-1 hover:border-gray-400 hover:text-gray-900 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
              Evidence (optional · up to {MAX_FUNDING_ATTACHMENTS} files)
            </label>
            {totalFiles > 0 && (
              <div className="flex flex-col gap-1.5 mb-2">
                {keptFiles.map((f, i) => {
                  const url = recordedUrls.get(f.path)
                  return (
                    <div key={`kept-${f.path}`} className="flex items-center gap-2 text-sm border border-[#e5e3df] rounded-lg px-3 py-1.5 bg-[#faf9f6]">
                      <Paperclip size={13} className="text-gray-400 flex-shrink-0" />
                      {url
                        ? <a href={url} target="_blank" rel="noreferrer" className="truncate flex-1 text-gray-800 hover:underline">{f.name}</a>
                        : <span className="truncate flex-1 text-gray-800">{f.name}</span>}
                      <span className="text-[11px] text-gray-400 flex-shrink-0">on file</span>
                      <button type="button" onClick={() => setKeptFiles(prev => prev.filter((_, idx) => idx !== i))} className="p-0.5 text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`}>
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
                {newFiles.map((f, i) => (
                  <div key={`new-${f.name}-${i}`} className="flex items-center gap-2 text-sm border border-[#e5e3df] rounded-lg px-3 py-1.5">
                    <Paperclip size={13} className="text-gray-400 flex-shrink-0" />
                    <span className="truncate flex-1 text-gray-800">{f.name}</span>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                    <button type="button" onClick={() => setNewFiles(prev => prev.filter((_, idx) => idx !== i))} className="p-0.5 text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              disabled={totalFiles >= MAX_FUNDING_ATTACHMENTS}
              onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
              className="text-sm w-full border border-[#e5e3df] rounded-lg px-3 py-2.5 disabled:opacity-50"
            />
            <p className="text-xs text-gray-400 mt-1.5">
              {isEditing && keptFiles.length === 0 && newFiles.length === 0
                ? 'No evidence on file — choose one or more files to attach them.'
                : isEditing
                  ? 'Select several at once, or add more one by one. A removed file is deleted when you save.'
                  : 'Select several at once, or add more one by one.'}
            </p>
          </div>

          {isEditing && editingFunding && (
            <div>
              <button
                type="button"
                onClick={() => setHistoryOpen(o => !o)}
                className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500 hover:text-gray-900"
              >
                <History size={11} /> History {historyOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {historyOpen && <div className="mt-2"><HistoryList entityType="funding" entityId={editingFunding.id} /></div>}
            </div>
          )}

          <p className="text-xs text-gray-500">
            {isEditing
              ? 'Only Finance can edit a recorded transfer.'
              : 'This adds to the project’s received funds and appears in the balance ledger. Only Finance can record funding.'}
          </p>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={loading} arrow>{isEditing ? 'Save changes' : 'Record transfer'}</Button>
            <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}
