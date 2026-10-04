'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronDown, X } from 'lucide-react'

interface Props {
  basePath: string
  articleTypes: string[]
  publications: string[]
}

const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
  { value: 'failed', label: 'Failed' },
]

const FILTER_KEYS = ['articleType', 'publication', 'status'] as const

// The filter half of the homepage's search+filter row (SearchInput handles
// the search box on the left). Each select pushes its own query param,
// dropping ?page so a new filter always starts back at page 1.
export default function CopywritingFilters({ basePath, articleTypes, publications }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function push(params: URLSearchParams) {
    params.delete('page')
    startTransition(() => {
      router.push(`${basePath}${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false })
    })
  }

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    push(params)
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString())
    FILTER_KEYS.forEach((k) => params.delete(k))
    push(params)
  }

  const hasActive = FILTER_KEYS.some((k) => searchParams.get(k))

  return (
    <div className={`flex flex-wrap items-center gap-2 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <FilterSelect
        label="Article type"
        allLabel="All article types"
        value={searchParams.get('articleType') || ''}
        options={articleTypes.map((t) => ({ value: t, label: t }))}
        onChange={(v) => setParam('articleType', v)}
      />
      <FilterSelect
        label="Publication"
        allLabel="All publications"
        value={searchParams.get('publication') || ''}
        options={publications.map((p) => ({ value: p, label: p }))}
        onChange={(v) => setParam('publication', v)}
      />
      <FilterSelect
        label="Status"
        allLabel="All statuses"
        value={searchParams.get('status') || ''}
        options={STATUS_OPTIONS}
        onChange={(v) => setParam('status', v)}
      />
      {hasActive && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 px-2 py-2.5 text-xs text-gray-500 hover:text-black transition-colors"
        >
          <X size={12} /> Clear
        </button>
      )}
    </div>
  )
}

// A native <select> (keeps keyboard/mobile pickers) styled as a pill that
// matches SearchInput's height: custom chevron, truncated long values, and a
// filled state when a filter is applied so active filters read at a glance.
function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const active = value !== ''
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        title={active ? value : allLabel}
        className={`appearance-none cursor-pointer rounded-full border py-2.5 pl-4 pr-9 text-sm max-w-[14rem] truncate transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black/20 ${
          active
            ? 'border-black bg-black text-white'
            : 'border-[#e5e3df] bg-white text-gray-600 hover:border-gray-400'
        }`}
      >
        <option value="" className="bg-white text-gray-900">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-white text-gray-900">{o.label}</option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 ${active ? 'text-white' : 'text-gray-400'}`}
      />
    </div>
  )
}
