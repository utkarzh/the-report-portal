'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

interface Props {
  search: string
  role: string
}

const roles = [
  { label: 'All', value: '' },
  { label: 'Admin', value: 'admin' },
  { label: 'User', value: 'user' },
]

function buildUrl(search: string, role: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (role) params.set('role', role)
  const qs = params.toString()
  return `/admin/users${qs ? `?${qs}` : ''}`
}

export default function UsersFilter({ search, role }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(search)
  const isFirstRender = useRef(true)

  // Sync local input if server-side search prop changes (e.g. cleared externally)
  useEffect(() => {
    setValue(search)
  }, [search])

  // Debounced auto-search — skip first render to avoid navigating on mount
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      router.push(buildUrl(value, role))
    }, 400)
    return () => clearTimeout(timer)
  }, [value])

  function handleRoleClick(r: string) {
    router.push(buildUrl(value, r))
  }

  function clearSearch() {
    setValue('')
    router.push(buildUrl('', role))
  }

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search name or email..."
          className="w-full text-xs bg-white border border-[#e5e3df] pl-8 pr-7 py-2 placeholder:text-gray-400 focus:outline-none focus:border-black transition-colors"
        />
        {value && (
          <button
            onClick={clearSearch}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-600 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        {roles.map((r) => (
          <button
            key={r.value}
            onClick={() => handleRoleClick(r.value)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              role === r.value
                ? 'bg-black text-white'
                : 'bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  )
}
