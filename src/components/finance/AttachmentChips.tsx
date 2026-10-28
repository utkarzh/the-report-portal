'use client'

import { Paperclip } from 'lucide-react'
import type { SignedAttachment } from '@/lib/finance-attachments'

// The evidence files on a funding row (migration 042: several per funding),
// each opening in place via the caller's receipt viewer.
export default function AttachmentChips({ attachments, onOpen }: { attachments: SignedAttachment[]; onOpen: (url: string | null) => void }) {
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((a, i) => (
        <button
          key={`${a.path}-${i}`}
          onClick={ev => { ev.stopPropagation(); onOpen(a.url) }}
          disabled={!a.url}
          title={a.name}
          className="inline-flex items-center gap-1 text-[11px] text-gray-600 border border-[#e5e3df] bg-white rounded-full px-2 py-0.5 hover:border-gray-300 hover:text-gray-900 disabled:opacity-50 transition-colors max-w-[200px]"
        >
          <Paperclip size={10} className="flex-shrink-0" />
          <span className="truncate">{a.name}</span>
        </button>
      ))}
    </div>
  )
}
