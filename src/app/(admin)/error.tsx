'use client'

import { useEffect } from 'react'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="p-8 flex flex-col items-start gap-4">
      <p className="text-sm font-medium text-gray-900">Something went wrong</p>
      <p className="text-xs text-gray-500 max-w-sm">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <button
        onClick={reset}
        className="text-xs font-medium text-white bg-black px-4 py-2 hover:bg-gray-900 transition-colors"
      >
        Try again
      </button>
    </div>
  )
}
