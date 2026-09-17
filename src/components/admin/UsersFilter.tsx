'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import {
  ACCESS_LABELS,
  EDITORIAL_ACCESS_KEYS,
  FINANCE_ACCESS_KEYS,
  parseAccessParam,
  serializeAccessParam,
  type AccessKey,
} from '@/lib/access-filters'

interface Props {
  search: string
  role: string
  usage: string
  access: string // comma-separated AccessKey list, straight from the URL
  nearCount: number
}

const roles = [
  { label: 'All', value: '' },
  { label: 'Admin', value: 'admin' },
  { label: 'User', value: 'user' },
]

function buildUrl(search: string, role: string, usage: string, access: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (role) params.set('role', role)
  if (usage) params.set('usage', usage)
  if (access) params.set('access', access)
  const qs = params.toString()
  return `/admin/users${qs ? `?${qs}` : ''}`
}

export default function UsersFilter({ search, role, usage, access, nearCount }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(search)
  const [isPending, startTransition] = useTransition()
  const isFirstRender = useRef(true)
  const [accessOpen, setAccessOpen] = useState(false)
  const accessRef = useRef<HTMLDivElement>(null)

  const selectedAccess = parseAccessParam(access)

  // Tracks the search string WE last pushed to the URL. A navigation we
  // trigger (the debounced search push, or any other filter change that
  // carries the current `value` along) takes a moment to resolve; if the
  // user keeps typing in that window, the resulting `search` prop reflects
  // the OLDER text. Without this guard, the sync effect below would reset
  // the input to that stale value — which looks exactly like a just-deleted
  // character reappearing. Only resync when `search` changed for a reason
  // other than our own push (typed URL, browser back/forward, etc).
  const lastPushedSearch = useRef(search)

  function push(nextSearch: string, nextRole: string, nextUsage: string, nextAccess: string) {
    lastPushedSearch.current = nextSearch
    // startTransition keeps the current table on screen instead of falling
    // back to the route's loading.tsx skeleton while the filtered page loads.
    startTransition(() => {
      router.push(buildUrl(nextSearch, nextRole, nextUsage, nextAccess), { scroll: false })
    })
  }

  useEffect(() => {
    if (search === lastPushedSearch.current) return
    setValue(search)
    lastPushedSearch.current = search
  }, [search])

  // Debounced auto-search — skip first render to avoid navigating on mount
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      push(value, role, usage, access)
    }, 400)
    return () => clearTimeout(timer)
  }, [value])

  // Close the access dropdown on outside click or Escape.
  useEffect(() => {
    if (!accessOpen) return
    function onPointerDown(e: MouseEvent) {
      if (accessRef.current && !accessRef.current.contains(e.target as Node)) setAccessOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccessOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [accessOpen])

  function handleRoleClick(r: string) {
    push(value, r, usage, access)
  }

  function toggleAccessKey(key: AccessKey) {
    const next = selectedAccess.includes(key)
      ? selectedAccess.filter((k) => k !== key)
      : [...selectedAccess, key]
    push(value, role, usage, serializeAccessParam(next))
  }

  function clearAccess() {
    push(value, role, usage, '')
  }

  function toggleNearLimit() {
    push(value, role, usage === 'near' ? '' : 'near', access)
  }

  function clearSearch() {
    setValue('')
    push('', role, usage, access)
  }

  return (
    <div className="flex items-center gap-3 mb-5 flex-wrap">
      <div className="relative flex-1 min-w-[240px] max-w-sm">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search name or email..."
          className="w-full text-sm bg-white border border-[#e5e3df] rounded-full pl-10 pr-9 py-2.5 placeholder:text-gray-400 focus:outline-none focus:border-black transition-colors"
        />
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
          {isPending ? (
            <Loader2 size={14} className="animate-spin text-gray-300" />
          ) : value ? (
            <button
              onClick={clearSearch}
              className="text-gray-300 hover:text-gray-600 transition-colors"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {/* Role tabs — a mutually-exclusive nav group */}
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

      {/* Near-limit — a standalone status toggle, deliberately pill-shaped
          (not another rectangular tab) so it doesn't read as a 4th Role option */}
      <button
        onClick={toggleNearLimit}
        title="Normal users at or near their monthly token limit"
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
          usage === 'near'
            ? 'bg-amber-500 border-amber-500 text-white'
            : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${usage === 'near' ? 'bg-white' : 'bg-amber-500'}`} />
        Near limit
        {nearCount > 0 && (
          <span
            className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              usage === 'near' ? 'bg-white/25 text-white' : 'bg-amber-200/70 text-amber-800'
            }`}
          >
            {nearCount}
          </span>
        )}
      </button>

      {/* Access filter — multi-select, grouped by department (editorial/finance) */}
      <div className="relative" ref={accessRef}>
        <button
          onClick={() => setAccessOpen((o) => !o)}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
            selectedAccess.length > 0
              ? 'bg-black text-white'
              : 'bg-white border border-[#e5e3df] text-gray-600 hover:border-gray-400'
          }`}
        >
          Access
          {selectedAccess.length > 0 && (
            <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold">
              {selectedAccess.length}
            </span>
          )}
          <svg
            className={`w-3 h-3 transition-transform ${accessOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {accessOpen && (
          <div className="absolute right-0 z-20 mt-1.5 w-56 bg-white border border-[#e5e3df] shadow-lg py-2">
            <div className="flex items-center justify-between px-3 pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Filter by access</span>
              {selectedAccess.length > 0 && (
                <button onClick={clearAccess} className="text-[10px] text-gray-400 hover:text-gray-700 transition-colors">
                  Clear
                </button>
              )}
            </div>

            <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Editorial</p>
            {EDITORIAL_ACCESS_KEYS.map((key) => (
              <AccessOption key={key} checked={selectedAccess.includes(key)} onToggle={() => toggleAccessKey(key)}>
                {ACCESS_LABELS[key]}
              </AccessOption>
            ))}

            <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Finance</p>
            {FINANCE_ACCESS_KEYS.map((key) => (
              <AccessOption key={key} checked={selectedAccess.includes(key)} onToggle={() => toggleAccessKey(key)}>
                {ACCESS_LABELS[key]}
              </AccessOption>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AccessOption({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-[#f9f8f6] cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-3.5 w-3.5 rounded-sm border-gray-300 text-black focus:ring-0 focus:ring-offset-0"
      />
      {children}
    </label>
  )
}
