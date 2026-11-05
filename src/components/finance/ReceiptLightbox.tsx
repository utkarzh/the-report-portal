'use client'

import { motion } from 'framer-motion'
import { X } from 'lucide-react'

// A signed URL's path (before the `?token=...` query string) still carries
// the original file extension, so this is enough to tell an image/PDF
// (previewable in-app) apart from a Word doc or anything else the browser
// can't render inline (falls back to opening in a new tab instead).
export function isPreviewableReceiptUrl(url: string | null | undefined): boolean {
  if (!url) return false
  const path = url.split('?')[0].toLowerCase()
  return /\.(jpg|jpeg|png|webp|gif|heic|heif|pdf)$/.test(path)
}

interface Props {
  url: string | null
  onClose: () => void
}

// In-app receipt preview, replacing the old "open in a new tab" behavior —
// same overlay/scale-in treatment as every other modal in this module
// (ExpenseDetailModal etc.), just full-bleed on the image/PDF itself.
export default function ReceiptLightbox({ url, onClose }: Props) {
  if (!url) return null
  const isPdf = url.split('?')[0].toLowerCase().endsWith('.pdf')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={e => e.stopPropagation()}
        className="relative max-w-4xl w-full max-h-[90vh] max-h-[90dvh] bg-white rounded-xl overflow-hidden shadow-2xl flex items-center justify-center"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 touch:w-11 touch:h-11 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
        >
          <X size={16} />
        </button>
        {/* iOS shows only a PDF's first page inside an iframe, without scrolling. */}
        {isPdf && (
          <a href={url} target="_blank" rel="noreferrer" className="absolute left-3 top-3 z-10 hidden rounded-full bg-black/60 px-3.5 py-3 text-xs font-medium text-white touch:block">
            Open full PDF
          </a>
        )}
        {isPdf ? (
          <iframe src={url} title="Receipt" className="w-full h-[85vh] h-[85dvh]" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Receipt" className="max-w-full max-h-[90vh] max-h-[90dvh] object-contain" />
        )}
      </motion.div>
    </div>
  )
}
