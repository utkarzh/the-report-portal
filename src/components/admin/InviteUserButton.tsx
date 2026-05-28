'use client'

import { useState } from 'react'
import InviteUserModal from './InviteUserModal'

export default function InviteUserButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-black text-white px-4 py-2 text-xs font-medium tracking-wider uppercase hover:bg-gray-900 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Invite User
      </button>

      <InviteUserModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}
