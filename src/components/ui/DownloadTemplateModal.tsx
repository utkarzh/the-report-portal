'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, FileText, FileType2, ArrowLeft, Check } from 'lucide-react'
import { TEMPLATES, DEFAULT_TEMPLATE_ID } from '@/lib/download-templates/registry'

// Two-step download picker: choose a branded template, then PDF or Word.
// Reusable across research / questions / transcripts — the caller supplies the
// download endpoint (`baseUrl`) and any endpoint-specific params (`extraParams`,
// e.g. { type: 'research' } or { variant: 'refined' }); this modal appends
// `template` and `format`.

interface Props {
  open: boolean
  onClose: () => void
  baseUrl: string
  extraParams?: Record<string, string>
  /** Suggested download filename base (no extension). */
  filenameBase?: string
}

const LS_KEY = 'download-template'

export default function DownloadTemplateModal({ open, onClose, baseUrl, extraParams, filenameBase }: Props) {
  const [step, setStep] = useState<'template' | 'format'>('template')
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID)

  useEffect(() => {
    if (!open) return
    setStep('template')
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(LS_KEY)
      if (saved && TEMPLATES.some((t) => t.id === saved)) setTemplateId(saved)
    }
  }, [open])

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  function pickTemplate(id: string) {
    setTemplateId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(LS_KEY, id)
    setStep('format')
  }

  function download(format: 'pdf' | 'docx') {
    const params = new URLSearchParams({ ...(extraParams ?? {}), template: templateId, format })
    const url = `${baseUrl}?${params.toString()}`
    const a = document.createElement('a')
    a.href = url
    if (filenameBase) a.download = `${filenameBase}.${format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    onClose()
  }

  const selected = TEMPLATES.find((t) => t.id === templateId)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} />
          <motion.div
            className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#e5e3df] px-5 py-4">
              <div className="flex items-center gap-2.5">
                {step === 'format' && (
                  <button
                    onClick={() => setStep('template')}
                    className="rounded-md p-1 text-gray-400 transition-colors hover:bg-[#f7f6f3] hover:text-gray-700"
                    title="Back to templates"
                  >
                    <ArrowLeft size={16} />
                  </button>
                )}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    {step === 'template' ? 'Choose a template' : 'Choose a format'}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {step === 'template'
                      ? 'The header and footer are styled to the publication.'
                      : selected?.label}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-[#f7f6f3] hover:text-gray-700"
              >
                <X size={17} />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-5">
              {step === 'template' ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => pickTemplate(t.id)}
                      className={`group relative flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                        t.id === templateId
                          ? 'border-black bg-[#faf9f7]'
                          : 'border-[#e5e3df] bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            t.brand === 'TRC' ? 'bg-black text-white' : 'bg-[#2E74B5] text-white'
                          }`}
                        >
                          {t.brand}
                        </span>
                        {t.kind === 'image' && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                            Sample
                          </span>
                        )}
                      </div>
                      <span className="text-[13px] font-medium leading-snug text-gray-900">{t.partner}</span>
                      {t.id === templateId && (
                        <span className="absolute right-2.5 bottom-2.5 text-black">
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <FormatCard
                    icon={<FileType2 size={22} />}
                    label="PDF"
                    hint="Print-ready, fixed layout"
                    onClick={() => download('pdf')}
                  />
                  <FormatCard
                    icon={<FileText size={22} />}
                    label="Word"
                    hint="Editable .docx"
                    onClick={() => download('docx')}
                  />
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FormatCard({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-6 text-center transition-all hover:-translate-y-0.5 hover:border-black hover:shadow-sm"
    >
      <span className="text-gray-700">{icon}</span>
      <span className="text-sm font-semibold text-gray-900">{label}</span>
      <span className="text-[11px] text-gray-400">{hint}</span>
    </button>
  )
}
