'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const errorParam = searchParams.get('error')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getSupabaseBrowserClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    // Check account status before navigating — Supabase Auth allows sign-in
    // regardless of our inactive flag, so we catch it here to avoid a
    // middleware redirect loop that leaves the button stuck on "loading".
    const { data: profile } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', data.user!.id)
      .single()

    if (profile?.status === 'inactive') {
      await supabase.auth.signOut()
      setError('Your account has been deactivated. Please contact an administrator.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">
      <div className="bg-white border border-[#e5e3df] p-8">
        <h1 className="text-sm font-semibold uppercase tracking-widest text-gray-900 mb-1">
          Sign In
        </h1>
        <p className="text-xs text-gray-500 mb-7">
          Enter your credentials to access the platform.
        </p>

        {errorParam === 'account_deactivated' && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-xs text-red-700">
            Your account has been deactivated. Please contact an administrator.
          </div>
        )}

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Email Address"
            type="email"
            placeholder="you@thereport.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="pt-2">
            <Button type="submit" loading={loading} arrow>
              Sign In
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm"><div className="bg-white border border-[#e5e3df] p-8"><p className="text-sm text-gray-400">Loading...</p></div></div>}>
      <LoginForm />
    </Suspense>
  )
}
