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
}: {
  target: FeedbackTarget
  departments: { id: string; name: string }[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const isNew = target.mode === 'suggest-new'
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-[#e5e3df] bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-800 hover:bg-gray-50"
      >
        {isNew ? <Plus size={14} /> : <Lightbulb size={14} />}
        {label ?? (isNew ? 'Suggest new knowledge' : 'Suggest a change')}
      </button>
      <FeedbackModal target={open ? target : null} departments={departments} onClose={() => setOpen(false)} />
    </>
  )
}
