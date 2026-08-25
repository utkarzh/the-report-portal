'use client'

import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import Button from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: string
  confirmLabel?: string
  confirmVariant?: 'primary' | 'danger'
  loading?: boolean
}

export default function Modal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmVariant = 'danger',
  loading,
}: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="modal-backdrop-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="modal-panel-in relative bg-white rounded-sm shadow-xl w-full max-w-sm mx-4 p-6">
        <div
          className={`mb-4 inline-flex h-9 w-9 items-center justify-center rounded-full ${
            confirmVariant === 'danger' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          {confirmVariant === 'danger' ? (
            <AlertTriangle size={18} strokeWidth={1.75} />
          ) : (
            <CheckCircle2 size={18} strokeWidth={1.75} />
          )}
        </div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{description}</p>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            className="flex-1 justify-center"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            size="sm"
            onClick={onConfirm}
            loading={loading}
            className="flex-1 justify-center"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
