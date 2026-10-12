'use client'

import { useState } from 'react'
import { Lightbulb, Plus } from 'lucide-react'
import FeedbackModal, { type FeedbackTarget } from '@/components/knowledge/FeedbackModal'

// "Suggest a change" on an item, or "Suggest new knowledge" inside a
// department (US-116).
export default function SuggestButton({
  target,
  departments,
  label,
  block = false,
}: {
  target: FeedbackTarget
  departments: { id: string; name: string }[]
  label?: string
  block?: boolean
}) {
  const [open, setOpen] = useState(false)
  const isNew = target.mode === 'suggest-new'
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-400 ${
          block ? 'w-full' : ''
        }`}
      >
        {isNew ? <Plus size={15} /> : <Lightbulb size={15} />}
        {label ?? (isNew ? 'Suggest new knowledge' : 'Suggest a change')}
      </button>
      <FeedbackModal target={open ? target : null} departments={departments} onClose={() => setOpen(false)} />
    </>
  )
}
