'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'

interface InviteData {
  email: string
  role: string
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const [invite, setInvite] = useState<InviteData | null>(null)
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'expired'>('loading')

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function validateToken() {
      const res = await fetch(`/api/invite?token=${token}`)
      if (res.status === 404) { setStatus('invalid'); return }
      if (res.status === 410) { setStatus('expired'); return }
      if (!res.ok) { setStatus('invalid'); return }
      const data = await res.json()
      setInvite(data)
      setStatus('valid')
    }
    validateToken()
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!invite) return
    setError(null)
    setLoading(true)

    // Create the account server-side so email is auto-confirmed (no confirmation email)
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, fullName, password }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to create account.')
      setLoading(false)
      return
    }

    // Account created and email confirmed — sign in immediately
    const supabase = getSupabaseBrowserClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: invite.email,
      password,
    })

    if (signInError) {
      setError('Account created but sign-in failed. Please go to the login page.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  if (status === 'loading') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-white border border-[#e5e3df] p-8 text-center">
          <p className="text-sm text-gray-500">Validating invite link...</p>
        </div>
      </div>
    )
  }

  if (status === 'invalid' || status === 'expired') {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-white border border-[#e5e3df] p-8 text-center">
          <p className="text-sm font-medium text-gray-900 mb-2">Link unavailable</p>
          <p className="text-xs text-gray-500">
            This invite link has expired or has already been used.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-white border border-[#e5e3df] p-8">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-gray-900 mb-1">
          Create Account
        </h1>
        <p className="text-xs text-gray-500 mb-7">
          You&apos;ve been invited to The Report Editorial.
        </p>

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Email Address"
            type="email"
            value={invite?.email || ''}
            readOnly
            className="text-gray-400 cursor-not-allowed"
          />
          <Input
            label="Full Name"
            type="text"
            placeholder="Your full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            placeholder="Create a password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <div className="pt-2">
            <Button type="submit" loading={loading} arrow>
              Create Account
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
