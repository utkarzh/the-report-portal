'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

interface Props {
  search: string
  role: string
  usage: string
  nearCount: number
}

const roles = [
  { label: 'All', value: '' },
  { label: 'Admin', value: 'admin' },
  { label: 'User', value: 'user' },
]

function buildUrl(search: string, role: string, usage: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (role) params.set('role', role)
  if (usage) params.set('usage', usage)
  const qs = params.toString()
  return `/admin/users${qs ? `?${qs}` : ''}`
}

export default function UsersFilter({ search, role, usage, nearCount }: Props) {
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
      router.push(buildUrl(value, role, usage))
    }, 400)
    return () => clearTimeout(timer)
  }, [value])

  function handleRoleClick(r: string) {
    router.push(buildUrl(value, r, usage))
  }

  function toggleNearLimit() {
    router.push(buildUrl(value, role, usage === 'near' ? '' : 'near'))
  }

  function clearSearch() {
    setValue('')
    router.push(buildUrl('', role, usage))
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

      {/* Role tabs + the near-limit filter as one cohesive tab group */}
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

        {/* Divider so it reads as a related-but-distinct filter (normal users only) */}
        <span className="mx-1 h-5 w-px bg-[#e5e3df]" />

        <button
          onClick={toggleNearLimit}
          title="Normal users at or near their monthly token limit"
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
            usage === 'near'
              ? 'bg-amber-500 text-white'
              : 'bg-white border border-[#e5e3df] text-gray-600 hover:border-amber-400 hover:text-amber-700'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${usage === 'near' ? 'bg-white' : 'bg-amber-500'}`} />
          Near limit
          {nearCount > 0 && (
            <span
              className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                usage === 'near' ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {nearCount}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
