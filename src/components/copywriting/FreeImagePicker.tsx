'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, ExternalLink, ImageIcon, Loader2, Search, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import type { FreeImage } from '@/lib/copywriting-free-images'
import type { CopywritingProjectImage } from '@/types'

interface Props {
  projectId: string
  slot: number
  description: string
  /** The slot already has a photo — "Use this photo" replaces it. */
  hasImage: boolean
  onImagesChange: (images: CopywritingProjectImage[]) => void
  onClose: () => void
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; queries: string[]; images: FreeImage[] }

// Free-to-use photos for one image slot: public domain / CC0 files from
// Wikimedia Commons, at least 1600px wide, landscape first. "Use this photo"
// puts one straight into the slot (the server fetches the 1920px file — sharp
// in the slot and the Word/PDF export); Download saves it instead.
export default function FreeImagePicker({ projectId, slot, description, hasImage, onImagesChange, onClose }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [usingId, setUsingId] = useState<string | null>(null)
  const [useError, setUseError] = useState<string | null>(null)

  async function applyImage(img: FreeImage) {
    setUsingId(img.id)
    setUseError(null)
    try {
      const res = await fetch(`/api/copywriting/${projectId}/images/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, url: img.downloadUrl, title: img.title, license: img.license }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUsingId(null)
        return setUseError(data.error || 'Could not use that photo. Try again, or download it instead.')
      }
      onImagesChange(data.images || [])
      onClose()
    } catch {
      setUsingId(null)
      setUseError('Could not use that photo. Check your connection and try again.')
    }
  }
  const panelRef = useRef<HTMLDivElement>(null)

  const search = useCallback(
    async (q: string) => {
      setState({ status: 'loading' })
      const params = new URLSearchParams({ slot: String(slot) })
      if (q.trim()) params.set('q', q.trim())
      try {
        const res = await fetch(`/api/copywriting/${projectId}/images/suggest?${params}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return setState({ status: 'error', message: data.error || 'Search failed. Try again.' })
        setState({ status: 'done', queries: data.queries || [], images: data.images || [] })
      } catch {
        setState({ status: 'error', message: 'Search failed. Check your connection and try again.' })
      }
    },
    [projectId, slot],
  )

  useEffect(() => {
    search('')
  }, [search])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !usingId && onClose()
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, usingId])

  const downloadHref = (img: FreeImage) =>
    `/api/copywriting/${projectId}/images/suggest/download?${new URLSearchParams({ url: img.downloadUrl, name: img.title })}`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={`Free images for image ${slot}`}>
      <div className="fixed inset-0 bg-black/40" onClick={() => !usingId && onClose()} />
      <div ref={panelRef} tabIndex={-1} className="relative w-full max-w-4xl bg-white shadow-xl focus:outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e3df] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">Free images for Image {slot}</h2>
            {description && <p className="mt-0.5 text-xs italic text-gray-500">{description}</p>}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-[#e5e3df] bg-[#faf9f7] px-5 py-3 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              search(query)
            }}
            className="flex gap-2"
          >
            <label className="flex min-w-0 flex-1 items-center gap-2 border border-[#e5e3df] bg-white px-3 focus-within:border-black">
              <Search size={13} className="flex-shrink-0 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for something else, e.g. solar farm"
                aria-label="Search free images"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={state.status === 'loading'}>
              Search
            </Button>
          </form>
          {state.status === 'done' && state.queries.length > 0 && (
            <p className="mt-2 text-[11px] text-gray-500">
              Searched for: {state.queries.map((q, i) => (
                <span key={q}>
                  {i > 0 && ' · '}
                  <span className="font-medium text-gray-700">{q}</span>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="px-5 py-5 sm:px-6">
          {hasImage && state.status === 'done' && state.images.length > 0 && (
            <p className="mb-4 text-xs text-gray-500">This slot already has a photo — choosing one here replaces it.</p>
          )}
          {useError && <p className="mb-4 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{useError}</p>}
          {state.status === 'loading' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Searching">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse border border-[#e5e3df]">
                  <div className="aspect-[3/2] bg-[#f0efec]" />
                  <div className="space-y-2 p-3">
                    <div className="h-3 w-3/4 bg-[#f0efec]" />
                    <div className="h-3 w-1/2 bg-[#f0efec]" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {state.status === 'error' && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-red-600">{state.message}</p>
              <Button size="sm" variant="secondary" onClick={() => search(query)}>
                Try again
              </Button>
            </div>
          )}

          {state.status === 'done' && state.images.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <ImageIcon size={20} className="text-gray-300" />
              <p className="mt-2 text-sm text-gray-700">No free, large-enough photos found.</p>
              <p className="mt-0.5 text-xs text-gray-500">Try a shorter, plainer search above, such as the main subject in two words.</p>
            </div>
          )}

          {state.status === 'done' && state.images.length > 0 && (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {state.images.map((img) => (
                <li key={img.id} className="flex flex-col border border-[#e5e3df] bg-white">
                  <a href={img.sourceUrl} target="_blank" rel="noreferrer" className="block aspect-[3/2] overflow-hidden bg-[#f7f6f3]" title="Open the source page">
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote preview from Wikimedia Commons */}
                    <img src={img.thumbUrl} alt={img.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
                  </a>
                  <div className="flex flex-1 flex-col gap-1.5 p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">{img.license}</span>
                      <span className="text-[11px] tabular-nums text-gray-500">
                        {img.downloadWidth.toLocaleString('en-US')} × {img.downloadHeight.toLocaleString('en-US')} px · {img.orientation}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-gray-800" title={img.title}>
                      {img.title}
                    </p>
                    {img.creator && <p className="truncate text-[11px] text-gray-400" title={img.creator}>By {img.creator}</p>}
                    <div className="mt-auto flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => applyImage(img)}
                        disabled={!!usingId}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-50"
                      >
                        {usingId === img.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        {usingId === img.id ? 'Adding…' : 'Use this photo'}
                      </button>
                      <a
                        href={downloadHref(img)}
                        title="Download"
                        aria-label={`Download ${img.title}`}
                        className={`inline-flex items-center justify-center border border-[#e5e3df] px-2.5 py-1.5 text-gray-600 transition-colors hover:border-gray-400 hover:text-black ${usingId ? 'pointer-events-none opacity-50' : ''}`}
                      >
                        <Download size={13} />
                      </a>
                      <a
                        href={img.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Source page on Wikimedia Commons"
                        aria-label={`Source page for ${img.title}`}
                        className="inline-flex items-center justify-center border border-[#e5e3df] px-2.5 py-1.5 text-gray-600 transition-colors hover:border-gray-400 hover:text-black"
                      >
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[#e5e3df] bg-[#faf9f7] px-5 py-3 text-[11px] leading-relaxed text-gray-500 sm:px-6">
          Public domain and CC0 photos from Wikimedia Commons: no copyright, free to use, no credit required. Downloads are 1,920 px wide (or the
          original, if smaller), sized for the image slot. <span className="font-medium text-gray-700">Use this photo</span> puts it straight into
          the slot; the download button saves it instead. Check the source page before publishing.
        </div>
      </div>
    </div>
  )
}
