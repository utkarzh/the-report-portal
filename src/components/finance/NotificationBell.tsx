'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import type { FinanceNotification } from '@/types'

// Brief G-02: "notified of what needs my attention" — in-app inbox (see the
// note in migration 018 about why this isn't email yet).
export default function NotificationBell() {
  const [notifications, setNotifications] = useState<FinanceNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/finance/notifications').then(r => r.json()).then(d => setNotifications(d.notifications ?? []))
  }, [])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const unread = notifications.filter(n => !n.read)

  async function markRead(id: string) {
    await fetch(`/api/finance/notifications/${id}/read`, { method: 'POST' })
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="relative text-gray-400 hover:text-white transition-colors">
        <Bell size={17} />
        {unread.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[9px] font-semibold min-w-[15px] h-[15px] px-0.5 rounded-full flex items-center justify-center">
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-white rounded-lg shadow-xl border border-[#e5e3df] max-h-80 overflow-y-auto z-50">
          {notifications.length === 0 ? (
            <div className="p-4 text-xs text-gray-400">No notifications.</div>
          ) : notifications.map(n => (
            <Link
              key={n.id}
              href={n.link || '#'}
              onClick={() => markRead(n.id)}
              className={`block px-3.5 py-2.5 text-xs border-b border-gray-100 last:border-0 hover:bg-gray-50 ${n.read ? 'text-gray-500' : 'text-gray-900 font-medium'}`}
            >
              {n.message}
              <div className="text-[10px] text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
