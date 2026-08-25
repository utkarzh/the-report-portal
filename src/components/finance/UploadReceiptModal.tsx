'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Upload, AlertTriangle, FileText } from 'lucide-react'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import ReceiptReadingLoader from './ReceiptReadingLoader'
import { SUB_LINES_BY_CATEGORY, defaultSubLine } from '@/lib/finance-categories'
import { FINANCE_EXPENSE_CATEGORY_LABELS } from '@/types'
import type { FinanceExpenseCategory } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onLogged: () => void
  projectId: string
  settlementCurrency: string
}

interface EditableEntry {
  concept: string
  category: FinanceExpenseCategory
  subLine: string
  date: string
  reference: string
  vendor: string
  localAmount: string
  localCurrency: string
  settlementAmount: number | null
  nights: string
  lowConfidenceFields: string[]
  suspiciousPersonal: boolean
  aiComment: string
  ruleViolation: string | null
}

type Step = 'upload' | 'reading' | 'confirm' | 'manual'

const CATEGORY_OPTIONS = Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

function blankEntry(): EditableEntry {
  return {
    concept: '', category: 'transport', subLine: defaultSubLine('transport'), date: new Date().toISOString().slice(0, 10),
    reference: '', vendor: '', localAmount: '', localCurrency: '', settlementAmount: null,
    nights: '', lowConfidenceFields: [], suspiciousPersonal: false, aiComment: '', ruleViolation: null,
  }
}

export default function UploadReceiptModal({ open, onClose, onLogged, projectId, settlementCurrency }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [receiptFilePath, setReceiptFilePath] = useState<string | null>(null)
  const [exchangeRate, setExchangeRate] = useState(1)
  const [entries, setEntries] = useState<EditableEntry[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const previewUrl = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  function reset() {
    setStep('upload'); setFile(null); setReceiptId(null); setReceiptFilePath(null)
    setEntries([]); setNote(null); setError(null)
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleRead() {
    if (!file) return
    setError(null)
    setStep('reading')

    try {
      const supabase = getSupabaseBrowserClient()
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${projectId}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('finance-receipts').upload(path, file)
      if (uploadError) throw new Error(uploadError.message)
      setReceiptFilePath(path)

      if (!file.type.startsWith('image/')) {
        // PDFs aren't read automatically yet — log manually, receipt is still attached.
        setEntries([blankEntry()])
        setStep('manual')
        return
      }

      const res = await fetch(`/api/finance/projects/${projectId}/receipts/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: path, mimeType: file.type }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEntries([blankEntry()])
        setStep('manual')
        return
      }

      setReceiptId(data.receiptId)
      setExchangeRate(data.exchangeRate)
      setNote(data.note || null)

      if (data.couldNotRead || data.entries.length === 0) {
        setEntries([blankEntry()])
        setStep('manual')
        return
      }

      setEntries(data.entries.map((e: {
        concept: string; category: FinanceExpenseCategory; subLine: string | null; date: string | null; reference: string | null
        vendor: string | null; localAmount: number | null; localCurrency: string | null
        settlementAmount: number | null; nights: number | null; lowConfidenceFields: string[]
        suspiciousPersonal: boolean; aiComment: string; ruleViolation: string | null
      }) => ({
        concept: e.concept || '',
        category: e.category,
        subLine: e.subLine || defaultSubLine(e.category),
        date: e.date || new Date().toISOString().slice(0, 10),
        reference: e.reference || '',
        vendor: e.vendor || '',
        localAmount: e.localAmount != null ? String(e.localAmount) : '',
        localCurrency: e.localCurrency || '',
        settlementAmount: e.settlementAmount,
        nights: e.nights != null ? String(e.nights) : '',
        lowConfidenceFields: e.lowConfidenceFields ?? [],
        suspiciousPersonal: e.suspiciousPersonal,
        aiComment: e.aiComment || '',
        ruleViolation: e.ruleViolation || null,
      })))
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
      setStep('upload')
    }
  }

  function updateEntry(i: number, patch: Partial<EditableEntry>) {
    setEntries(prev => prev.map((e, idx) => {
      if (idx !== i) return e
      const next = { ...e, ...patch }
      if (patch.category && patch.category !== e.category) next.subLine = defaultSubLine(patch.category)
      const amt = parseFloat(next.localAmount)
      next.settlementAmount = Number.isFinite(amt) && exchangeRate ? Math.round((amt / exchangeRate) * 100) / 100 : null
      return next
    }))
  }

  async function handleLog() {
    setError(null)
    for (const e of entries) {
      if (!e.concept.trim() || !e.date || !e.localAmount || !e.localCurrency.trim()) {
        setError('Every entry needs a concept, date, amount and currency.')
        return
      }
    }
    setLoading(true)
    const res = await fetch(`/api/finance/projects/${projectId}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiptId,
        receiptFilePath: receiptId ? null : receiptFilePath,
        entries: entries.map(e => ({
          category: e.category,
          subLine: e.subLine || null,
          concept: e.concept.trim(),
          date: e.date,
          reference: e.reference.trim() || null,
          vendor: e.vendor.trim() || null,
          localAmount: parseFloat(e.localAmount),
          localCurrency: e.localCurrency.trim().toUpperCase(),
          settlementAmount: e.settlementAmount ?? parseFloat(e.localAmount),
          nights: e.nights ? parseInt(e.nights, 10) : null,
          lowConfidenceFields: e.lowConfidenceFields,
          suspiciousPersonal: e.suspiciousPersonal,
          aiComment: e.aiComment || null,
          ruleViolation: e.ruleViolation || null,
        })),
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to log the expense.')
      setLoading(false)
      return
    }

    setLoading(false)
    reset()
    onLogged()
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-white w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl flex flex-col rounded-xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df] sticky top-0 bg-white z-10">
          <h2 className="text-sm font-semibold text-gray-900">Log an expense</h2>
          <button onClick={handleClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-6">
          {error && <div className="p-3 mb-4 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{error}</div>}

          {step === 'upload' && (
            <div>
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors duration-200 ${
                  dragOver
                    ? 'border-[#c8973f] bg-[#fbf7ed]'
                    : file
                      ? 'border-[#e5e3df] bg-[#faf9f6]'
                      : 'border-[#d8d5cf] bg-[#faf9f6] hover:border-[#c8973f]/50 hover:bg-[#fbf7ed]/40'
                }`}
              >
                <input
                  type="file"
                  accept="image/*,.pdf"
                  capture="environment"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                {file ? (
                  <>
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="Receipt preview" className="h-24 w-24 rounded-xl object-cover border border-[#e5e3df] shadow-sm" />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-white border border-[#e5e3df] flex items-center justify-center text-[#c8973f] shadow-sm">
                        <FileText size={22} />
                      </div>
                    )}
                    <div className="max-w-full">
                      <div className="text-sm font-medium text-gray-900 truncate max-w-[280px] mx-auto">{file.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(0)} KB · tap to replace</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-14 w-14 rounded-full bg-white border border-[#e5e3df] flex items-center justify-center text-[#c8973f] shadow-sm transition-transform duration-200 group-hover:scale-105">
                      <Upload size={22} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-700">Take a photo or drop a receipt</div>
                      <div className="text-xs text-gray-400 mt-1">JPG, PNG, PDF · photos, screenshots, ride-app history</div>
                    </div>
                    <span className="mt-1 text-xs font-medium text-[#a07530] bg-[#fbf7ed] border border-[#c8973f]/30 rounded-full px-3.5 py-1.5">
                      Choose a file
                    </span>
                  </>
                )}
              </label>
              <Button className="mt-4" disabled={!file} onClick={handleRead}>
                Upload &amp; read receipt
              </Button>
            </div>
          )}

          {step === 'reading' && <ReceiptReadingLoader />}

          {step === 'manual' && (
            <div className="p-3 mb-4 bg-amber-50 border border-amber-200 text-sm text-amber-800 rounded">
              This receipt couldn&apos;t be read automatically — please fill in the details manually. It&apos;s still attached to this expense.
            </div>
          )}

          {(step === 'confirm' || step === 'manual') && (
            <div className="flex flex-col gap-5">
              {note && step === 'confirm' && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-sm text-blue-800 rounded">✨ {note}</div>
              )}
              {entries.map((entry, i) => (
                <div key={i} className="border border-[#e5e3df] rounded-xl p-4">
                  {entries.length > 1 && <div className="text-xs font-semibold text-gray-500 mb-2">Trip {i + 1}</div>}
                  {entry.aiComment && (
                    <div className={`flex items-center gap-1.5 text-xs rounded px-2.5 py-1.5 mb-3 ${entry.suspiciousPersonal ? 'text-amber-700 bg-amber-50 border border-amber-200' : 'text-blue-700 bg-blue-50 border border-blue-200'}`}>
                      {entry.suspiciousPersonal && <AlertTriangle size={13} className="flex-shrink-0" />} {entry.aiComment}
                    </div>
                  )}
                  {entry.ruleViolation && (
                    <div className="flex items-center gap-1.5 text-xs rounded px-2.5 py-1.5 mb-3 text-red-700 bg-red-50 border border-red-200">
                      <AlertTriangle size={13} className="flex-shrink-0" /> This project's rules flag this: {entry.ruleViolation}
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Concept</label>
                      <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={entry.concept} onChange={e => updateEntry(i, { concept: e.target.value })} />
                    </div>
                    <Select
                      label="Category"
                      options={CATEGORY_OPTIONS}
                      value={entry.category}
                      onChange={e => updateEntry(i, { category: e.target.value as FinanceExpenseCategory })}
                      placeholder=""
                    />
                    <Select
                      label="Sub-line"
                      options={SUB_LINES_BY_CATEGORY[entry.category].map(s => ({ value: s, label: s }))}
                      value={entry.subLine}
                      onChange={e => updateEntry(i, { subLine: e.target.value })}
                      placeholder=""
                    />
                    <div>
                      <label className={`text-[10px] font-semibold uppercase tracking-widest block mb-1 ${entry.lowConfidenceFields.includes('date') ? 'text-amber-600' : 'text-gray-500'}`}>Date</label>
                      <input type="date" className={`w-full text-sm border rounded-lg px-3 py-2 ${entry.lowConfidenceFields.includes('date') ? 'border-amber-400 bg-amber-50' : 'border-[#e5e3df]'}`} value={entry.date} onChange={e => updateEntry(i, { date: e.target.value })} />
                    </div>
                    <div>
                      <label className={`text-[10px] font-semibold uppercase tracking-widest block mb-1 ${entry.lowConfidenceFields.includes('reference') ? 'text-amber-600' : 'text-gray-500'}`}>Reference</label>
                      <input className={`w-full text-sm border rounded-lg px-3 py-2 ${entry.lowConfidenceFields.includes('reference') ? 'border-amber-400 bg-amber-50' : 'border-[#e5e3df]'}`} value={entry.reference} onChange={e => updateEntry(i, { reference: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Vendor</label>
                      <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={entry.vendor} onChange={e => updateEntry(i, { vendor: e.target.value })} />
                    </div>
                    {entry.category === 'accommodation' && (
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Nights</label>
                        <input type="number" min="1" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={entry.nights} onChange={e => updateEntry(i, { nights: e.target.value })} />
                      </div>
                    )}
                    <div>
                      <label className={`text-[10px] font-semibold uppercase tracking-widest block mb-1 ${entry.lowConfidenceFields.includes('localAmount') ? 'text-amber-600' : 'text-gray-500'}`}>Local amount</label>
                      <input type="number" step="0.01" className={`w-full text-sm border rounded-lg px-3 py-2 tabular-nums ${entry.lowConfidenceFields.includes('localAmount') ? 'border-amber-400 bg-amber-50' : 'border-[#e5e3df]'}`} value={entry.localAmount} onChange={e => updateEntry(i, { localAmount: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Local currency</label>
                      <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 uppercase" value={entry.localCurrency} onChange={e => updateEntry(i, { localCurrency: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2 text-xs text-gray-500 pt-1">
                      {entry.settlementAmount != null
                        ? `≈ ${settlementCurrency} ${entry.settlementAmount.toFixed(2)} at rate ${exchangeRate}`
                        : 'Enter a local amount to see the converted total.'}
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-3">
                <Button loading={loading} onClick={handleLog}>
                  Log {entries.length > 1 ? `${entries.length} expenses` : 'expense'}
                </Button>
                <button onClick={handleClose} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
