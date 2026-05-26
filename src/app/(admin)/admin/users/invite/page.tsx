'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'

export default function InviteUserPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', role: 'user', tokenLimit: '100000' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        role: form.role,
        tokenLimit: parseInt(form.tokenLimit),
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Failed to create invitation.')
      setLoading(false)
      return
    }

    setInviteUrl(data.inviteUrl)
    setLoading(false)
  }

  async function copyLink() {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors mb-4 flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Users
        </button>
        <h1 className="text-base font-semibold text-gray-900">Invite User</h1>
        <p className="text-xs text-gray-500 mt-1">
          Send an invite link to a new user. Their role and token limit will be set automatically.
        </p>
      </div>

      <div className="bg-white border border-[#e5e3df] p-6 max-w-md">
        {inviteUrl ? (
          <div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 mb-5">
              <p className="text-xs font-medium text-emerald-700 mb-1">Invite created</p>
              <p className="text-xs text-emerald-600">
                Copy the link below and send it to {form.email}.
              </p>
            </div>
            <div className="flex gap-2 mb-5">
              <input
                value={inviteUrl}
                readOnly
                className="flex-1 text-xs bg-gray-50 border border-[#e5e3df] px-3 py-2 text-gray-600 truncate"
              />
              <button
                onClick={copyLink}
                className="px-3 py-2 bg-black text-white text-xs font-medium hover:bg-gray-900 transition-colors flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => { setInviteUrl(null); setForm({ email: '', role: 'user', tokenLimit: '100000' }) }}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Create another invite
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <Input
              label="Email Address *"
              type="email"
              placeholder="user@example.com"
              value={form.email}
              onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
              required
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

            <Input
              label="Monthly Token Limit *"
              type="number"
              placeholder="100000"
              value={form.tokenLimit}
              onChange={(e) => setForm(p => ({ ...p, tokenLimit: e.target.value }))}
              min="1000"
              required
            />

            <div className="pt-2">
              <Button type="submit" loading={loading} arrow>
                Send Invite
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
