'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import EditUserForm from '@/components/admin/EditUserForm'
import type { Profile } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  user: Profile
  isSelf: boolean
}

// First letter of each of the first two words in the name (falling back to
// the email) — a quick visual anchor for "which user is this" that a generic
// pencil icon didn't give.
function initials(fullName: string | null, email: string): string {
  const source = (fullName || '').trim() || email
  const parts = source.split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)
  return letters.toUpperCase()
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
        className="relative bg-white w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-modal-title"
      >
        <span className="absolute inset-x-0 top-0 h-0.5 bg-black" aria-hidden="true" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold tracking-wide">
              {initials(user.full_name, user.email)}
            </div>
            <div className="min-w-0">
              <h2 id="edit-user-modal-title" className="text-sm font-semibold text-gray-900 truncate">
                {user.full_name || 'Edit User'}
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
