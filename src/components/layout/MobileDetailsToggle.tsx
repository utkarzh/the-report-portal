'use client'

import { ChevronDown } from 'lucide-react'

// Below lg, a workspace's side panel shrinks to its title with this toggle, so
// the document it describes gets the screen. On desktop the panel shows
// everything and this is hidden.
export default function MobileDetailsToggle({ open, onToggle, label = 'Details' }: {
  open: boolean
  onToggle: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="-my-2 -mr-2 inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-xs font-medium text-gray-500 hover:text-gray-900 lg:hidden"
    >
      {label}
      <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}
