'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'

type Result =
  | { type: 'invite'; url: string; email: string }
  | { type: 'created'; email: string }

const defaultForm = { email: '', fullName: '', role: 'user', tokenLimit: '2000000' }

export default function InviteUserPage() {
  const router = useRouter()
  const [form, setForm] = useState(defaultForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
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
    // Refresh so the users list is up to date when the admin navigates back.
    router.refresh()
    setLoading(false)
  }

  async function copyLink() {
    if (result?.type !== 'invite') return
    await navigator.clipboard.writeText(result.url)
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
        <h1 className="text-base font-semibold text-gray-900">Add User</h1>
        <p className="text-xs text-gray-500 mt-1">
          Add a new team member. Their role and token limit are applied automatically.
        </p>
      </div>

      <div className="bg-white border border-[#e5e3df] p-6 max-w-md">
        {result?.type === 'invite' ? (
          <div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 mb-5">
              <p className="text-xs font-medium text-emerald-700 mb-1">Admin invite created</p>
              <p className="text-xs text-emerald-600">
                Copy the link below and send it to {result.email}. They&apos;ll set a password on signup.
              </p>
            </div>
            <div className="flex gap-2 mb-5">
              <input
                value={result.url}
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
              onClick={() => { setResult(null); setForm(defaultForm) }}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Add another user
            </button>
          </div>
        ) : result?.type === 'created' ? (
          <div>
            <div className="p-3 bg-emerald-50 border border-emerald-200 mb-5">
              <p className="text-xs font-medium text-emerald-700 mb-1">User added</p>
              <p className="text-xs text-emerald-600">
                {result.email} can sign in now — they enter their email and a one-time code is sent to the
                editorial inbox to relay. No password or signup needed.
              </p>
            </div>
            <button
              onClick={() => { setResult(null); setForm(defaultForm) }}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Add another user
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

            <div className="pt-2">
              <Button type="submit" loading={loading} arrow>
                Add User
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
