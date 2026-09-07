'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { SALES_COACH_PRIVACY_NOTICE } from '@/lib/sales-coach'

// US-047: shown once, the first time the user opens the Sales Negotiation Coach,
// with a "Got it" button. After dismissal it stays reachable via a discreet
// "Privacy and data use" link. No consent checkbox on subsequent uploads.
export default function PrivacyNotice({ acknowledged }: { acknowledged: boolean }) {
  const [open, setOpen] = useState(!acknowledged)
  const [saving, setSaving] = useState(false)

  async function dismiss() {
    setSaving(true)
    try {
      if (!acknowledged) {
        await fetch('/api/sales-coach/privacy-ack', { method: 'POST' }).catch(() => {})
      }
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-gray-900">
              <ShieldCheck size={18} />
              <h3 className="text-sm font-semibold">Privacy &amp; data use</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600">{SALES_COACH_PRIVACY_NOTICE}</p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={dismiss}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discreet always-available re-open link (footer/help style). */}
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 underline underline-offset-2 hover:text-gray-600"
      >
        Privacy and data use
      </button>
    </>
  )
}
