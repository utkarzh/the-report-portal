'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import AuthCard from '@/components/layout/AuthCard'

const MIN_LENGTH = 8

// Step 2 of the admin password reset, opened from the emailed link
// (/reset-password?token=<hashed recovery token>). The token is checked with
// verifyOtp only when the new password is submitted, not when the page loads, so
// an email client or link scanner opening the link can't use it up. After the
// password changes, every session for the account is signed out (global sign-out)
// and the admin signs in again normally, which also claims this device's
// one-device-one-login slot.
function ResetPasswordForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(false)
  // The token works once. If it verified but the new password was then refused
  // (too weak, same as before), the next attempt reuses that session.
  const [verified, setVerified] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords don’t match.')
      return
    }
    setLoading(true)
    const supabase = getSupabaseBrowserClient()
    try {
      if (!verified) {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' })
        if (verifyError || !data.user) {
          setExpired(true)
          return
        }
        setVerified(true)
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(
          /different from the old/i.test(updateError.message)
            ? 'Choose a password different from your current one.'
            : updateError.message || 'Could not change the password. Please try again.',
        )
        return
      }
      await supabase.auth.signOut({ scope: 'global' }).catch(() => supabase.auth.signOut())
      router.replace('/login?reset=success')
    } catch {
      setError('Could not reach the sign-in service. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token || expired) {
    return (
      <AuthCard>
        <h1 className="mb-4 text-base font-semibold text-gray-900">This link has expired</h1>
        <div className="mb-5 p-3 bg-amber-50 border border-amber-200 text-xs leading-5 text-amber-800">
          {token
            ? 'This password reset link is invalid, has already been used, or has expired.'
            : 'This password reset link is incomplete.'}{' '}
          Request a new one and use the latest email.
        </div>
        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="text-xs font-medium text-gray-700 hover:text-black transition-colors">
            Send a new link
          </Link>
          <Link href="/login" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard>
      <h1 className="mb-2 text-base font-semibold text-gray-900">Choose a new password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <p className="text-xs leading-5 text-gray-500">
          At least {MIN_LENGTH} characters. Once it&apos;s changed, you&apos;ll be signed out everywhere and can sign in with the new password.
        </p>
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
        )}
        <Input
          label="New Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          autoComplete="new-password"
        />
        <Input
          label="Confirm New Password"
          type="password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
        <div className="pt-2">
          <Button type="submit" loading={loading} arrow>
            Change password
          </Button>
        </div>
      </form>
    </AuthCard>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthCard><p className="text-sm text-gray-400">Loading...</p></AuthCard>}>
      <ResetPasswordForm />
    </Suspense>
  )
}
