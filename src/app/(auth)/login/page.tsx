'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import AuthCard from '@/components/layout/AuthCard'

type Stage = 'email' | 'password' | 'otp'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const errorParam = searchParams.get('error')

  // After any successful sign-in, block deactivated accounts before navigating.
  async function finishSignIn(userId: string, method: 'password' | 'otp') {
    const supabase = getSupabaseBrowserClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single()

    if (profile?.status === 'inactive') {
      await supabase.auth.signOut()
      setError('Your account has been deactivated. Please contact an administrator.')
      setLoading(false)
      return
    }

    // Claim this account's single active-device slot. This rewrites the account's
    // active session id and mirrors it into an httpOnly cookie, signing out any
    // other device on its next request ("newest login wins"). If it fails we
    // don't proceed, otherwise the middleware would sign this device out too.
    const registerRes = await fetch('/api/auth/session-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    })
    if (!registerRes.ok) {
      await supabase.auth.signOut()
      setError('Could not complete sign-in on this device. Please try again.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  // Step 1 — identify the account and branch to password (admin) or OTP (user).
  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || 'Could not start sign-in. Please try again.')
        setLoading(false)
        return
      }

      if (data.method === 'password') {
        setStage('password')
      } else {
        setStage('otp')
        setNotice('A login code has been sent to your email. Enter it below to finish signing in.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2a — admin password sign-in.
  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getSupabaseBrowserClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError || !data.user) {
      setError('Invalid email or password.')
      setLoading(false)
      return
    }

    await finishSignIn(data.user.id, 'password')
  }

  // Step 2b — normal user OTP sign-in (code relayed manually by editorial team).
  async function handleOtp(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = getSupabaseBrowserClient()
    const token = code.trim()

    // The code is minted via admin.generateLink({type:'magiclink'}); it verifies
    // with type 'email'. Fall back to 'magiclink' to be resilient across
    // Supabase versions before treating it as a genuinely bad code.
    let result = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (result.error || !result.data.user) {
      result = await supabase.auth.verifyOtp({ email, token, type: 'magiclink' })
    }

    if (result.error || !result.data.user) {
      setError('Invalid or expired code. Please try again.')
      setLoading(false)
      return
    }

    await finishSignIn(result.data.user.id, 'otp')
  }

  // Resend / regenerate the OTP for the same email.
  async function resendCode() {
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not resend the code.')
      } else {
        setNotice('A new login code has been sent to your email.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function resetToEmail() {
    setStage('email')
    setPassword('')
    setCode('')
    setError(null)
    setNotice(null)
  }

  return (
    <AuthCard>
        {errorParam === 'account_deactivated' && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-xs text-red-700">
            Your account has been deactivated. Please contact an administrator.
          </div>
        )}

        {errorParam === 'session_expired' && (
          <div className="mb-5 p-3 bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Your session has expired. Please sign in again.
          </div>
        )}

        {errorParam === 'signed_in_elsewhere' && (
          <div className="mb-5 p-3 bg-amber-50 border border-amber-200 text-xs text-amber-800">
            You&apos;ve been signed out because your account was signed in on another device.
          </div>
        )}

        {notice && (
          <div className="mb-5 p-3 bg-amber-50 border border-amber-200 text-xs text-amber-800">
            {notice}
          </div>
        )}

        {error && (
          <div className="mb-5 p-3 bg-red-50 border border-red-200 text-xs text-red-700">
            {error}
          </div>
        )}

        {stage === 'email' && (
          <form onSubmit={handleIdentify} className="flex flex-col gap-5">
            <Input
              label="Email Address"
              type="email"
              placeholder="you@thereport.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <div className="pt-2">
              <Button type="submit" loading={loading} arrow>
                Sign In
              </Button>
            </div>
          </form>
        )}

        {stage === 'password' && (
          <form onSubmit={handlePassword} className="flex flex-col gap-5">
            <Input
              label="Email Address"
              type="email"
              value={email}
              disabled
              readOnly
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              autoComplete="current-password"
            />
            <div className="pt-2">
              <Button type="submit" loading={loading} arrow>
                Sign In
              </Button>
            </div>
            <button
              type="button"
              onClick={resetToEmail}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Use a different email
            </button>
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={handleOtp} className="flex flex-col gap-5">
            <Input
              label="Login Code"
              type="text"
              inputMode="numeric"
              placeholder="Enter the code you were given"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
              autoComplete="one-time-code"
            />
            <div className="pt-2">
              <Button type="submit" loading={loading} arrow>
                Verify &amp; Sign In
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={resendCode}
                disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
              >
                Resend code
              </button>
              <button
                type="button"
                onClick={resetToEmail}
                className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
              >
                Use a different email
              </button>
            </div>
          </form>
        )}
    </AuthCard>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthCard><p className="text-sm text-gray-400">Loading...</p></AuthCard>}>
      <LoginForm />
    </Suspense>
  )
}
