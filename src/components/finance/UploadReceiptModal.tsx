'use client'

import { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import { X, Upload, AlertTriangle, FileText, FileArchive } from 'lucide-react'
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

// One per uploaded file — a batch upload produces one group per receipt, each
// logged as its own finance_receipts row + its own set of finance_expenses
// (a single receipt can still expand into several entries, e.g. a multi-trip
// ride-app screenshot; a batch just means several of these side by side).
interface ReceiptGroup {
  key: string
  fileName: string
  receiptId: string | null
  receiptFilePath: string
  exchangeRate: number
  note: string | null
  entries: EditableEntry[]
  couldNotRead: boolean
  submitError: string | null
}

type Step = 'select' | 'reading' | 'confirm'

const CATEGORY_OPTIONS = Object.entries(FINANCE_EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'])

function extToMimeType(ext: string): string | null {
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (IMAGE_EXTENSIONS.has(ext)) return `image/${ext}`
  return null
}

// Zips are expanded client-side only — receipts inside are still uploaded
// and read one by one exactly like individually-picked files. Anything in
// the archive that isn't an image or a PDF (folders, .DS_Store, __MACOSX
// junk) is silently skipped rather than rejected.
async function expandZip(zipFile: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipFile)
  const out: File[] = []
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const name = path.split('/').pop() || path
    if (!name || name.startsWith('.') || path.startsWith('__MACOSX')) continue
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const mimeType = extToMimeType(ext)
    if (!mimeType) continue
    const blob = await entry.async('blob')
    out.push(new File([blob], name, { type: mimeType }))
  }
  return out
}

function blankEntry(): EditableEntry {
  return {
    concept: '', category: 'transport', subLine: defaultSubLine('transport'), date: new Date().toISOString().slice(0, 10),
    reference: '', vendor: '', localAmount: '', localCurrency: '', settlementAmount: null,
    nights: '', lowConfidenceFields: [], suspiciousPersonal: false, aiComment: '', ruleViolation: null,
  }
}

export default function UploadReceiptModal({ open, onClose, onLogged, projectId, settlementCurrency }: Props) {
  const [step, setStep] = useState<Step>('select')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [expandingZip, setExpandingZip] = useState(false)
  const [readProgress, setReadProgress] = useState<{ index: number; total: number; fileName: string } | null>(null)
  const [groups, setGroups] = useState<ReceiptGroup[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const previewUrls = useMemo(
    () => pendingFiles.map(f => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [pendingFiles],
  )
  useEffect(() => () => { previewUrls.forEach(u => u && URL.revokeObjectURL(u)) }, [previewUrls])

  function reset() {
    setStep('select'); setPendingFiles([]); setExpandingZip(false); setReadProgress(null)
    setGroups([]); setGlobalError(null); setLoading(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function addFiles(incoming: File[]) {
    if (incoming.length === 0) return
    setGlobalError(null)
    const zips = incoming.filter(f => f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip')
    const rest = incoming.filter(f => !zips.includes(f))

    let extracted: File[] = []
    if (zips.length > 0) {
      setExpandingZip(true)
      try {
        for (const zipFile of zips) {
          extracted = extracted.concat(await expandZip(zipFile))
        }
        if (extracted.length === 0) {
          setGlobalError('No images or PDFs were found inside the ZIP file.')
        }
      } catch {
        setGlobalError('Could not read that ZIP file — it may be corrupted.')
      }
      setExpandingZip(false)
    }

    setPendingFiles(prev => [...prev, ...rest, ...extracted])
  }

  function removeFile(index: number) {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
  }

  function handleDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragOver(false)
    addFiles(Array.from(e.dataTransfer.files ?? []))
  }

  async function handleReadAll() {
    if (pendingFiles.length === 0) return
    setGlobalError(null)
    setStep('reading')

    const supabase = getSupabaseBrowserClient()
    const nextGroups: ReceiptGroup[] = []

    for (let i = 0; i < pendingFiles.length; i++) {
      const file = pendingFiles[i]
      setReadProgress({ index: i + 1, total: pendingFiles.length, fileName: file.name })

      try {
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `${projectId}/${crypto.randomUUID()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('finance-receipts').upload(path, file)
        if (uploadError) throw new Error(uploadError.message)

        const mimeType = file.type || extToMimeType(ext) || 'application/octet-stream'
        const canAutoRead = mimeType.startsWith('image/') || mimeType === 'application/pdf'

        if (!canAutoRead) {
          nextGroups.push({
            key: path, fileName: file.name, receiptId: null, receiptFilePath: path,
            exchangeRate: 1, note: null, entries: [blankEntry()], couldNotRead: true, submitError: null,
          })
          continue
        }

        const res = await fetch(`/api/finance/projects/${projectId}/receipts/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath: path, mimeType }),
        })
        const data = await res.json()

        if (!res.ok || data.couldNotRead || data.entries.length === 0) {
          nextGroups.push({
            key: path, fileName: file.name, receiptId: data.receiptId ?? null, receiptFilePath: path,
            exchangeRate: data.exchangeRate ?? 1, note: null, entries: [blankEntry()], couldNotRead: true, submitError: null,
          })
          continue
        }

        const exchangeRate = data.exchangeRate
        nextGroups.push({
          key: path,
          fileName: file.name,
          receiptId: data.receiptId,
          receiptFilePath: path,
          exchangeRate,
          note: data.note || null,
          couldNotRead: false,
          submitError: null,
          entries: data.entries.map((e: {
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
          })),
        })
      } catch (err) {
        nextGroups.push({
          key: `${file.name}-${i}`, fileName: file.name, receiptId: null, receiptFilePath: '',
          exchangeRate: 1, note: null, entries: [],
          couldNotRead: true,
          submitError: err instanceof Error ? err.message : 'Upload failed.',
        })
      }
    }

    setGroups(nextGroups)
    setReadProgress(null)
    setStep('confirm')
  }

  function updateEntry(groupKey: string, entryIndex: number, patch: Partial<EditableEntry>) {
    setGroups(prev => prev.map(g => {
      if (g.key !== groupKey) return g
      return {
        ...g,
        entries: g.entries.map((e, idx) => {
          if (idx !== entryIndex) return e
          const next = { ...e, ...patch }
          if (patch.category && patch.category !== e.category) next.subLine = defaultSubLine(patch.category)
          const amt = parseFloat(next.localAmount)
          next.settlementAmount = Number.isFinite(amt) && g.exchangeRate ? Math.round((amt / g.exchangeRate) * 100) / 100 : null
          return next
        }),
      }
    }))
  }

  function removeGroup(groupKey: string) {
    setGroups(prev => prev.filter(g => g.key !== groupKey))
  }

  async function handleLogAll() {
    setGlobalError(null)

    for (const g of groups) {
      if (g.entries.length === 0) {
        setGlobalError(`"${g.fileName}" couldn't be uploaded — remove it and try again.`)
        return
      }
      for (const e of g.entries) {
        if (!e.concept.trim() || !e.date || !e.localAmount || !e.localCurrency.trim()) {
          setGlobalError(`"${g.fileName}": every entry needs a concept, date, amount and currency.`)
          return
        }
      }
    }

    setLoading(true)
    const failed: ReceiptGroup[] = []
    let succeededCount = 0

    for (const g of groups) {
      const res = await fetch(`/api/finance/projects/${projectId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: g.receiptId,
          receiptFilePath: g.receiptId ? null : g.receiptFilePath,
          entries: g.entries.map(e => ({
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
        failed.push({ ...g, submitError: data.error || 'Failed to log this receipt.' })
      } else {
        succeededCount++
      }
    }

    setLoading(false)

    if (failed.length > 0) {
      setGroups(failed)
      setGlobalError(
        succeededCount > 0
          ? `${succeededCount} of ${groups.length} receipt(s) logged. Fix the error(s) below to log the rest.`
          : 'Failed to log the expense(s) below.',
      )
      return
    }

    reset()
    onLogged()
    onClose()
  }

  if (!open) return null

  const totalEntryCount = groups.reduce((sum, g) => sum + g.entries.length, 0)

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
          {globalError && <div className="p-3 mb-4 bg-red-50 border border-red-200 text-sm text-red-700 rounded">{globalError}</div>}

          {step === 'select' && (
            <div>
              <label
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`group relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors duration-200 ${
                  dragOver
                    ? 'border-[#c8973f] bg-[#fbf7ed]'
                    : 'border-[#d8d5cf] bg-[#faf9f6] hover:border-[#c8973f]/50 hover:bg-[#fbf7ed]/40'
                }`}
              >
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,application/pdf,.zip,application/zip"
                  capture="environment"
                  onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
                  className="sr-only"
                />
                <div className="h-14 w-14 rounded-full bg-white border border-[#e5e3df] flex items-center justify-center text-[#c8973f] shadow-sm transition-transform duration-200 group-hover:scale-105">
                  <Upload size={22} />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-700">Take a photo or drop receipts</div>
                  <div className="text-xs text-gray-400 mt-1">JPG, PNG, PDF, or a ZIP of receipts · select or drop several at once</div>
                </div>
                <span className="mt-1 text-xs font-medium text-[#a07530] bg-[#fbf7ed] border border-[#c8973f]/30 rounded-full px-3.5 py-1.5">
                  Choose file(s)
                </span>
              </label>

              {expandingZip && <div className="mt-3 text-xs text-gray-500">Unzipping…</div>}

              {pendingFiles.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {pendingFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-3 border border-[#e5e3df] rounded-lg px-3 py-2 bg-[#faf9f6]">
                      {previewUrls[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewUrls[i]!} alt="" className="h-9 w-9 rounded object-cover border border-[#e5e3df] flex-shrink-0" />
                      ) : (
                        <div className="h-9 w-9 rounded bg-white border border-[#e5e3df] flex items-center justify-center text-[#c8973f] flex-shrink-0">
                          <FileText size={16} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-900 truncate">{f.name}</div>
                        <div className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</div>
                      </div>
                      <button onClick={() => removeFile(i)} className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Button className="mt-4" disabled={pendingFiles.length === 0 || expandingZip} onClick={handleReadAll}>
                {pendingFiles.length > 1 ? `Upload & read ${pendingFiles.length} receipts` : 'Upload & read receipt'}
              </Button>
            </div>
          )}

          {step === 'reading' && <ReceiptReadingLoader batch={readProgress ?? undefined} />}

          {step === 'confirm' && (
            <div className="flex flex-col gap-5">
              {groups.map(group => (
                <div key={group.key} className="border border-[#e5e3df] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#faf9f6] border-b border-[#e5e3df]">
                    <div className="flex items-center gap-2 min-w-0 text-xs font-semibold text-gray-600">
                      <FileArchive size={13} className="flex-shrink-0 text-[#c8973f]" />
                      <span className="truncate">{group.fileName}</span>
                      {group.entries.length > 1 && <span className="text-gray-400 font-normal">· {group.entries.length} entries</span>}
                    </div>
                    <button onClick={() => removeGroup(group.key)} className="text-xs text-gray-400 hover:text-red-600 flex-shrink-0">
                      Remove
                    </button>
                  </div>

                  <div className="p-4 flex flex-col gap-4">
                    {group.submitError && (
                      <div className="flex items-center gap-1.5 text-xs rounded px-2.5 py-1.5 text-red-700 bg-red-50 border border-red-200">
                        <AlertTriangle size={13} className="flex-shrink-0" /> {group.submitError}
                      </div>
                    )}
                    {group.couldNotRead && (
                      <div className="p-3 bg-amber-50 border border-amber-200 text-sm text-amber-800 rounded">
                        This receipt couldn&apos;t be read automatically — please fill in the details manually. It&apos;s still attached to this expense.
                      </div>
                    )}
                    {group.note && !group.couldNotRead && (
                      <div className="p-3 bg-blue-50 border border-blue-200 text-sm text-blue-800 rounded">✨ {group.note}</div>
                    )}

                    {group.entries.map((entry, i) => (
                      <div key={i} className="border border-[#e5e3df] rounded-xl p-4">
                        {group.entries.length > 1 && <div className="text-xs font-semibold text-gray-500 mb-2">Trip {i + 1}</div>}
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
                            <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={entry.concept} onChange={e => updateEntry(group.key, i, { concept: e.target.value })} />
                          </div>
                          <Select
                            label="Category"
                            options={CATEGORY_OPTIONS}
                            value={entry.category}
                            onChange={e => updateEntry(group.key, i, { category: e.target.value as FinanceExpenseCategory })}
                            placeholder=""
                          />
                          <Select
                            label="Sub-line"
                            options={SUB_LINES_BY_CATEGORY[entry.category].map(s => ({ value: s, label: s }))}
                            value={entry.subLine}
                            onChange={e => updateEntry(group.key, i, { subLine: e.target.value })}
                            placeholder=""
                          />
                          <div>
                            <label className={`text-[10px] font-semibold uppercase tracking-widest block mb-1 ${entry.lowConfidenceFields.includes('date') ? 'text-amber-600' : 'text-gray-500'}`}>Date</label>
                            <input type="date" className={`w-full text-sm border rounded-lg px-3 py-2 ${entry.lowConfidenceFields.includes('date') ? 'border-amber-400 bg-amber-50' : 'border-[#e5e3df]'}`} value={entry.date} onChange={e => updateEntry(group.key, i, { date: e.target.value })} />
                          </div>
                          <div>
                            <label className={`text-[10px] font-semibold uppercase tracking-widest block mb-1 ${entry.lowConfidenceFields.includes('reference') ? 'text-amber-600' : 'text-gray-500'}`}>Reference</label>
                            <input className={`w-full text-sm border rounded-lg px-3 py-2 ${entry.lowConfidenceFields.includes('reference') ? 'border-amber-400 bg-amber-50' : 'border-[#e5e3df]'}`} value={entry.reference} onChange={e => updateEntry(group.key, i, { reference: e.target.value })} />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Vendor</label>
                            <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={entry.vendor} onChange={e => updateEntry(group.key, i, { vendor: e.target.value })} />
                          </div>
                          {entry.category === 'accommodation' && (
                            <div>
                              <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Nights</label>
                              <input type="number" min="1" className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2" value={entry.nights} onChange={e => updateEntry(group.key, i, { nights: e.target.value })} />
                            </div>
                          )}
                          <div>
                            <label className={`text-[10px] font-semibold uppercase tracking-widest block mb-1 ${entry.lowConfidenceFields.includes('localAmount') ? 'text-amber-600' : 'text-gray-500'}`}>Local amount</label>
                            <input type="number" step="0.01" className={`w-full text-sm border rounded-lg px-3 py-2 tabular-nums ${entry.lowConfidenceFields.includes('localAmount') ? 'border-amber-400 bg-amber-50' : 'border-[#e5e3df]'}`} value={entry.localAmount} onChange={e => updateEntry(group.key, i, { localAmount: e.target.value })} />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1">Local currency</label>
                            <input className="w-full text-sm border border-[#e5e3df] rounded-lg px-3 py-2 uppercase" value={entry.localCurrency} onChange={e => updateEntry(group.key, i, { localCurrency: e.target.value })} />
                          </div>
                          <div className="sm:col-span-2 text-xs text-gray-500 pt-1">
                            {entry.settlementAmount != null
                              ? `≈ ${settlementCurrency} ${entry.settlementAmount.toFixed(2)} at rate ${group.exchangeRate}`
                              : 'Enter a local amount to see the converted total.'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {groups.length === 0 && (
                <div className="text-sm text-gray-500">Nothing left to log — every receipt was removed.</div>
              )}

              <div className="flex items-center gap-3">
                <Button loading={loading} disabled={groups.length === 0} onClick={handleLogAll}>
                  Log {totalEntryCount > 1 ? `${totalEntryCount} expenses` : 'expense'}
                  {groups.length > 1 ? ` across ${groups.length} receipts` : ''}
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
