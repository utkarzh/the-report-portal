'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Search, X, Loader2 } from 'lucide-react'

interface SearchInputProps {
  basePath: string
  initialValue: string
  placeholder?: string
  paramKey?: string
  className?: string
}

// A debounced, URL-driven search box for server-rendered, paginated list
// pages: it pushes `?search=` (dropping `?page=`, so a new search always
// starts back at page 1). The push is wrapped in startTransition — the same
// technique EntityCard already uses for card navigation — so React keeps the
// current list on screen (and this input shows its own small spinner)
// instead of falling back to the route's loading.tsx skeleton while the
// filtered page streams in.
export default function SearchInput({
  basePath,
  initialValue,
  placeholder = 'Search...',
  paramKey = 'search',
  className = '',
}: SearchInputProps) {
  const router = useRouter()
  const [value, setValue] = useState(initialValue)
  const [isPending, startTransition] = useTransition()
  const isFirstRender = useRef(true)
  const lastPushed = useRef(initialValue)

  function push(next: string) {
    lastPushed.current = next
    const params = new URLSearchParams()
    if (next) params.set(paramKey, next)
    const qs = params.toString()
    startTransition(() => {
      router.push(`${basePath}${qs ? `?${qs}` : ''}`, { scroll: false })
    })
  }

  // Resync if the value changed for a reason other than our own push
  // (browser back/forward, a direct link with ?search= already in it).
  useEffect(() => {
    if (initialValue === lastPushed.current) return
    setValue(initialValue)
    lastPushed.current = initialValue
  }, [initialValue])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timer = setTimeout(() => push(value), 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function clear() {
    setValue('')
    push('')
  }

  return (
    <div className={`relative w-full max-w-sm ${className}`}>
      <Search className="pointer-events-none absolute left-4 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-full border border-[#e5e3df] bg-white py-2.5 pl-10 pr-9 text-sm placeholder:text-gray-400 focus:border-black focus:outline-none transition-colors"
      />
      <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
        {isPending ? (
          <Loader2 size={14} className="animate-spin text-gray-300" />
        ) : value ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="text-gray-300 transition-colors hover:text-gray-600"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
