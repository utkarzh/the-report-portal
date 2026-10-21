'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, LayoutList, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { MAX_SECTION_NAME_LENGTH, MAX_SECTION_DESCRIPTION_LENGTH } from '@/lib/copywriting'
import type { CopywritingLibrarySection } from '@/types'

const API = '/api/copywriting/admin/sections'
// The search box only earns its place once the list is long.
const SEARCH_FROM = 8

// The admin-managed library of sections writers build articles from: a label
// and its definition for the AI (what the label means — "TEXT" is the
// article's body). Each article sets its own length per section.
export default function SectionLibraryManager({ initial }: { initial: CopywritingLibrarySection[] }) {
  const router = useRouter()
  const [sections, setSections] = useState(initial)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<CopywritingLibrarySection | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const sorted = (list: CopywritingLibrarySection[]) => [...list].sort((a, b) => a.name.localeCompare(b.name))
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sections.filter((s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) : sections
  }, [sections, query])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setAddError('Enter a section name')
    setAdding(true)
    setAddError(null)
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) })
    const data = await res.json().catch(() => ({}))
    setAdding(false)
    if (!res.ok) return setAddError(data.error || 'Failed to add the section.')
    setSections((prev) => sorted([...prev, data.section]))
    setName('')
    setDescription('')
    router.refresh()
  }

  function startEdit(s: CopywritingLibrarySection) {
    setEditingId(s.id)
    setEditName(s.name)
    setEditDescription(s.description || '')
    setEditError(null)
  }

  async function saveEdit() {
    if (!editingId) return
    const current = sections.find((s) => s.id === editingId)
    if (!editName.trim()) return setEditError('Enter a section name')
    if (current && editName.trim() === current.name && editDescription.trim() === (current.description || '').trim()) return setEditingId(null)
    setSaving(true)
    setEditError(null)
    const res = await fetch(`${API}/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editName, description: editDescription }) })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) return setEditError(data.error || 'Failed to rename.')
    setSections((prev) => sorted(prev.map((s) => (s.id === editingId ? data.section : s))))
    setEditingId(null)
    router.refresh()
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setListError(null)
    const res = await fetch(`${API}/${deleting.id}`, { method: 'DELETE' })
    setDeleteBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setListError(data.error || 'Failed to delete the section.')
    } else {
      setSections((prev) => prev.filter((s) => s.id !== deleting.id))
      router.refresh()
    }
    setDeleting(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={add} className="bg-white border border-[#e5e3df] p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-gray-900">Add a section</h2>
        <p className="mt-1 text-xs text-gray-500">
          A label, and what it means so the AI fills it correctly. Writers set how many characters it needs when they drop it into an article.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setAddError(null)
            }}
            maxLength={MAX_SECTION_NAME_LENGTH}
            placeholder="e.g. Introduction, Market overview, Closing quote"
            aria-label="Section name"
            className="min-w-0 flex-1 border border-[#e5e3df] bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none"
          />
        </div>
        <label className="mt-3 block">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">What this section is (for the AI)</span>
            <span className="text-[10px] text-gray-400">optional · {description.length}/{MAX_SECTION_DESCRIPTION_LENGTH}</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={MAX_SECTION_DESCRIPTION_LENGTH}
            rows={2}
            placeholder="e.g. TEXT — the article's main body: the running prose that tells the story, with the quotes and facts."
            className="mt-1.5 w-full resize-y border border-[#e5e3df] bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-black focus:outline-none"
          />
        </label>
        <p className="mt-1 text-[11px] text-gray-400">
          Sent to the AI with the section, so it knows what the label stands for and writes the right kind of text in it. Writers see it too.
        </p>
        {addError && <p className="mt-2 text-xs text-red-500">{addError}</p>}
        <div className="mt-4 flex justify-end">
          <Button type="submit" size="sm" loading={adding}>
            <Plus size={13} className="mr-1.5 inline" /> Add section
          </Button>
        </div>
      </form>

      <section className="bg-white border border-[#e5e3df]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e3df] px-5 py-3.5 sm:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            {sections.length} section{sections.length === 1 ? '' : 's'}
          </p>
          {sections.length >= SEARCH_FROM && (
            <label className="flex items-center gap-2 border border-[#e5e3df] px-2.5 py-1.5 focus-within:border-black">
              <Search size={12} className="text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sections"
                aria-label="Search sections"
                className="w-40 bg-transparent text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
            </label>
          )}
        </div>

        {listError && <p className="px-5 pt-3 text-xs text-red-500 sm:px-6">{listError}</p>}

        {sections.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f4f1]">
              <LayoutList size={16} className="text-gray-500" />
            </span>
            <p className="mt-3 text-sm font-medium text-gray-900">No sections yet</p>
            <p className="mt-1 max-w-sm text-xs text-gray-500">
              Writers can&apos;t configure an article until there&apos;s at least one. Add the building blocks your articles use.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-gray-400">No section matches “{query}”.</p>
        ) : (
          <ul className="divide-y divide-[#e5e3df]">
            <AnimatePresence initial={false}>
              {visible.map((s) => (
                <motion.li
                  key={s.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="group flex items-start gap-3 px-5 py-3 sm:px-6"
                >
                  {editingId === s.id ? (
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          placeholder="Section name"
                          value={editName}
                          maxLength={MAX_SECTION_NAME_LENGTH}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveEdit()
                            }
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          aria-label="Section name"
                          className="min-w-0 flex-1 border border-black bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={saving}
                          className="p-1.5 text-gray-500 transition-colors hover:text-emerald-600 disabled:opacity-50"
                          title="Save (Enter)"
                        >
                          <Check size={15} />
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className="p-1.5 text-gray-400 transition-colors hover:text-black" title="Cancel (Esc)">
                          <X size={15} />
                        </button>
                      </div>
                      <textarea
                        value={editDescription}
                        maxLength={MAX_SECTION_DESCRIPTION_LENGTH}
                        onChange={(e) => setEditDescription(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingId(null)
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            saveEdit()
                          }
                        }}
                        rows={2}
                        placeholder="What this section is, for the AI (optional)"
                        aria-label="What this section is, for the AI"
                        className="w-full resize-y border border-[#e5e3df] bg-white px-2.5 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-black focus:outline-none"
                      />
                      {editError && <p className="text-xs text-red-500">{editError}</p>}
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-gray-900">{s.name}</p>
                        {s.description ? (
                          <p className="mt-0.5 whitespace-pre-line text-xs text-gray-500">{s.description}</p>
                        ) : (
                          <button type="button" onClick={() => startEdit(s)} className="mt-0.5 text-xs text-gray-400 underline-offset-2 hover:text-gray-700 hover:underline">
                            Add what this section is
                          </button>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <button type="button" onClick={() => startEdit(s)} className="p-1.5 text-gray-400 transition-colors hover:text-black" title="Rename">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => setDeleting(s)} className="p-1.5 text-gray-300 transition-colors hover:text-red-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={`Delete “${deleting?.name ?? ''}”?`}
        description="Writers won't be able to add it to new articles. Articles already configured keep it in their structure."
        confirmLabel="Delete"
        confirmVariant="danger"
        loading={deleteBusy}
      />
    </div>
  )
}
