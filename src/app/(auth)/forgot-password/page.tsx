'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import AuthCard from '@/components/layout/AuthCard'

// Step 1 of the admin password reset: ask for the email, and the server emails a
// reset link (POST /api/auth/forgot-password). The reply is the same for any
// email, so the page never says whether an account exists.
function ForgotPasswordForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Could not send the reset email. Please try again.')
        return
      }
      setSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard>
      <h1 className="mb-2 text-base font-semibold text-gray-900">Reset your password</h1>

      {sent ? (
        <div className="flex flex-col gap-5">
          <div className="p-3 bg-amber-50 border border-amber-200 text-xs leading-5 text-amber-800">
            If <span className="font-semibold">{email.trim()}</span> belongs to an admin account, we&apos;ve emailed it a link to reset the password. Check your inbox (and spam folder). The link expires shortly and can only be used once.
          </div>
          <p className="text-xs leading-5 text-gray-500">
            Team members sign in with a code sent by email and don&apos;t need a password.
          </p>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setSent(false)}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Send the link again
            </button>
            <Link href="/login" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <p className="text-xs leading-5 text-gray-500">
            Enter the email you sign in with, and we&apos;ll send you a link to choose a new password.
          </p>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
          )}
          <Input
            label="Email Address"
            type="email"
            placeholder="you@thereport.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={!email}
            autoComplete="email"
          />
          <div className="pt-2">
            <Button type="submit" loading={loading} arrow>
              Send reset link
            </Button>
          </div>
          <Link href="/login" className="text-center text-xs text-gray-400 hover:text-gray-700 transition-colors">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthCard>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthCard><p className="text-sm text-gray-400">Loading...</p></AuthCard>}>
      <ForgotPasswordForm />
    </Suspense>
  )
}
