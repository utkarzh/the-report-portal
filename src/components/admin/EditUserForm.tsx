'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import type { Profile } from '@/types'

interface Props {
  user: Profile
  isSelf: boolean
}

export default function EditUserForm({ user, isSelf }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    fullName: user.full_name || '',
    role: user.role,
    tokenLimit: user.token_limit != null ? String(user.token_limit) : '2000000',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: form.fullName,
        // Don't send role when editing self — API blocks any role change on own account
        ...(!isSelf && { role: form.role }),
        // Admins have no token limit; only send one for normal users.
        ...(form.role !== 'admin' && { tokenLimit: parseInt(form.tokenLimit) }),
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to update user.')
    } else {
      setSuccess(true)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}
      {success && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
          User updated successfully.
        </div>
      )}

      <Input
        label="Email"
        value={user.email}
        readOnly
        className="text-gray-400 cursor-not-allowed"
      />

      <Input
        label="Full Name"
        value={form.fullName}
        onChange={(e) => setForm(p => ({ ...p, fullName: e.target.value }))}
        placeholder="Full name"
      />

      <Select
        label="Role *"
        options={[
          { value: 'user', label: 'Normal User' },
          { value: 'admin', label: 'Admin' },
        ]}
        value={form.role}
        onChange={(e) => setForm(p => ({ ...p, role: e.target.value as 'admin' | 'user' }))}
        disabled={isSelf}
        placeholder=""
      />
      {isSelf && (
        <p className="text-[10px] text-gray-400 -mt-3">You cannot change your own role.</p>
      )}

      {form.role === 'admin' ? (
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 block mb-1.5">
            Token Limit
          </label>
          <p className="text-xs text-gray-500 bg-gray-50 border border-[#e5e3df] px-3 py-2.5">
            Admins have no token limit.
          </p>
        </div>
      ) : (
        <Input
          label="Token Limit *"
          type="number"
          value={form.tokenLimit}
          onChange={(e) => setForm(p => ({ ...p, tokenLimit: e.target.value }))}
          min="1000"
          required
        />
      )}

      <div className="pt-2">
        <Button type="submit" loading={loading} arrow>
          Save Changes
        </Button>
      </div>
    </form>
  )
}
