'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { X, UserPlus, Copy, Check } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'

interface Props {
  open: boolean
  onClose: () => void
}

const defaultForm = { email: '', fullName: '', role: 'user', tokenLimit: '2000000' }

// Admins get an invite link (they set a password on signup). Normal users have
// their account created immediately and sign in with a one-time code.
type Result =
  | { type: 'invite'; url: string; email: string }
  | { type: 'created'; email: string }

export default function InviteUserModal({ open, onClose }: Props) {
  const router = useRouter()
  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  // Focus first input when modal opens; reset when it closes
  useEffect(() => {
    if (open) {
      setTimeout(() => firstInputRef.current?.focus(), 50)
    } else {
      setForm(defaultForm)
      setError(null)
      setResult(null)
      setCopied(false)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        fullName: form.fullName,
        role: form.role,
        // Admins have no token limit; only send one for normal users.
        ...(form.role !== 'admin' && { tokenLimit: parseInt(form.tokenLimit) }),
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to add user.')
      setLoading(false)
      return
    }

    if (data.method === 'invite') {
      setResult({ type: 'invite', url: data.inviteUrl, email: form.email })
    } else {
      setResult({ type: 'created', email: form.email })
    }
    // Re-fetch the users table behind the modal so the new user shows up
    // immediately, without a manual reload.
    router.refresh()
    setLoading(false)
  }

  async function copyLink() {
    if (result?.type !== 'invite') return
    await navigator.clipboard.writeText(result.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleAnother() {
    setResult(null)
    setForm(defaultForm)
    setError(null)
    setTimeout(() => firstInputRef.current?.focus(), 50)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative bg-white w-full max-w-md shadow-2xl flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#e5e3df]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black flex items-center justify-center flex-shrink-0">
              <UserPlus size={15} className="text-white" />
            </div>
            <div>
              <h2 id="invite-modal-title" className="text-sm font-semibold text-gray-900">
                Add User
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Add a new team member to the platform
              </p>
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
        <div className="px-6 py-6">
          {result?.type === 'invite' ? (
            /* Admin success state — share the signup link */
            <div className="flex flex-col gap-5">
              <div className="p-4 bg-emerald-50 border border-emerald-200">
                <p className="text-sm font-medium text-emerald-800 mb-1">Admin invite created</p>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  Copy the link below and send it to <span className="font-medium">{result.email}</span>.
                  They&apos;ll set a password on signup. The link expires in 7 days and can only be used once.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
                  Invite Link
                </label>
                <div className="flex gap-2">
                  <input
                    value={result.url}
                    readOnly
                    className="flex-1 min-w-0 text-xs bg-gray-50 border border-[#e5e3df] px-3 py-2.5 text-gray-600 truncate focus:outline-none"
                  />
                  <button
                    onClick={copyLink}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-black text-white text-xs font-medium hover:bg-gray-900 transition-colors flex-shrink-0"
                  >
                    {copied
                      ? <><Check size={13} /> Copied</>
                      : <><Copy size={13} /> Copy</>
                    }
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-1">
                <button
                  onClick={handleAnother}
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors underline underline-offset-2"
                >
                  Add another user
                </button>
                <button
                  onClick={onClose}
                  className="text-xs font-medium text-gray-700 hover:text-black transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : result?.type === 'created' ? (
            /* Normal-user success state — account ready, no link needed */
            <div className="flex flex-col gap-5">
              <div className="p-4 bg-emerald-50 border border-emerald-200">
                <p className="text-sm font-medium text-emerald-800 mb-1">User added</p>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  <span className="font-medium">{result.email}</span> can now sign in. They enter their
                  email at the login page and a one-time code is sent to the editorial inbox — relay that
                  code to them to complete sign-in. No password or signup needed.
                </p>
              </div>

              <div className="flex items-center gap-4 pt-1">
                <button
                  onClick={handleAnother}
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors underline underline-offset-2"
                >
                  Add another user
                </button>
                <button
                  onClick={onClose}
                  className="text-xs font-medium text-gray-700 hover:text-black transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Form state */
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700">
                  {error}
                </div>
              )}

              <Input
                ref={firstInputRef}
                label="Email Address *"
                type="email"
                placeholder="user@example.com"
                value={form.email}
                onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
                required
              />

              <Input
                label="Full Name"
                type="text"
                placeholder="e.g. Jane Doe"
                value={form.fullName}
                onChange={(e) => setForm(p => ({ ...p, fullName: e.target.value }))}
              />

              <Select
                label="Role *"
                options={[
                  { value: 'user', label: 'Normal User' },
                  { value: 'admin', label: 'Admin' },
                ]}
                value={form.role}
                onChange={(e) => setForm(p => ({ ...p, role: e.target.value }))}
                placeholder=""
              />

              {form.role === 'admin' ? (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
                    Monthly Token Limit
                  </label>
                  <p className="text-xs text-gray-500 bg-gray-50 border border-[#e5e3df] px-3 py-2.5">
                    Admins have no token limit.
                  </p>
                </div>
              ) : (
                <Input
                  label="Monthly Token Limit *"
                  type="number"
                  placeholder="2000000"
                  value={form.tokenLimit}
                  onChange={(e) => setForm(p => ({ ...p, tokenLimit: e.target.value }))}
                  min="1000"
                  required
                />
              )}

              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" loading={loading} arrow>
                  Add User
                </Button>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
