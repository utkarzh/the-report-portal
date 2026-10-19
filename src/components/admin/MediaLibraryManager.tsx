'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Pencil } from 'lucide-react'
import Input from '@/components/ui/Input'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { MEDIA_LIBRARY_PATH, mediaDetailBadges } from '@/lib/media-library'
import type { MediaLibraryEntry } from '@/types'

interface Props {
  initialEntries: MediaLibraryEntry[]
  guideCounts: Record<string, number>
}

export default function MediaLibraryManager({ initialEntries, guideCounts }: Props) {
  const router = useRouter()
  const [entries, setEntries] = useState(initialEntries)
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<MediaLibraryEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    const res = await fetch('/api/media-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, country }),
    })
    const data = await res.json().catch(() => ({}))
    setCreating(false)
    if (!res.ok) {
      setError(data.error || 'Failed to add the publication.')
      return
    }
    // Straight to its page, where the module-specific details are added.
    router.push(`${MEDIA_LIBRARY_PATH}/${data.media.id}`)
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    const res = await fetch(`/api/media-library/${deleting.id}`, { method: 'DELETE' })
    setDeleteBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Failed to delete the publication.')
    } else {
      setEntries((prev) => prev.filter((x) => x.id !== deleting.id))
      router.refresh()
    }
    setDeleting(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={create} className="border border-[#e5e3df] bg-white p-5 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Plus size={14} /> Add a publication
        </h2>
        {error && <div className="mb-4 border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Publication name *" placeholder="e.g. Der Spiegel" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Country" placeholder="e.g. Germany" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div className="mt-4">
          <Button type="submit" size="sm" loading={creating}>Add publication</Button>
        </div>
      </form>

      <section className="border border-[#e5e3df] bg-white">
        <div className="border-b border-[#e5e3df] px-5 py-4 sm:px-6">
          <h2 className="text-sm font-semibold text-gray-900">Publications ({entries.length})</h2>
        </div>
        {entries.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400 sm:px-6">No publications yet.</p>
        ) : (
          <ul className="divide-y divide-[#e5e3df]">
            {entries.map((m) => {
              const badges = mediaDetailBadges(m, guideCounts[m.id] || 0)
              return (
                <li key={m.id} className="flex items-start gap-3 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <Link href={`${MEDIA_LIBRARY_PATH}/${m.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      {m.name}
                    </Link>
                    {m.country && <span className="ml-2 text-xs text-gray-400">{m.country}</span>}
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {badges.length === 0 ? (
                        <span className="text-[11px] text-gray-400">Name and country only</span>
                      ) : (
                        badges.map((b) => (
                          <span key={b} className="bg-[#f0efec] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{b}</span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Link href={`${MEDIA_LIBRARY_PATH}/${m.id}`} className="p-1.5 text-gray-400 transition-colors hover:text-black" title="Edit">
                      <Pencil size={14} />
                    </Link>
                    <button type="button" onClick={() => setDeleting(m)} className="p-1.5 text-gray-300 transition-colors hover:text-red-500" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete "${deleting?.name || ''}"?`}
        description="It disappears from every tool's publication list, along with its Meeting Prep profile, letter description, Copywriting rules and style guides. Work already created keeps the publication name it was saved with."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteBusy}
      />
    </div>
  )
}
