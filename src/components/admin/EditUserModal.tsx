'use client'

import { useEffect } from 'react'
import { X, PencilLine } from 'lucide-react'
import EditUserForm from '@/components/admin/EditUserForm'
import type { Profile } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  user: Profile
  isSelf: boolean
}

export default function EditUserModal({ open, onClose, user, isSelf }: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative bg-white w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-black flex items-center justify-center flex-shrink-0">
              <PencilLine size={15} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="edit-user-modal-title" className="text-sm font-semibold text-gray-900">
                Edit User
              </h2>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 overflow-y-auto">
          <EditUserForm user={user} isSelf={isSelf} onSuccess={onClose} />
        </div>
      </div>
    </div>
  )
}
