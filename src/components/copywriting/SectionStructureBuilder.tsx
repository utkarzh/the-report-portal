'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronUp, GripVertical, LayoutList, Plus, Search, X } from 'lucide-react'
import { MAX_ARTICLE_SECTIONS, sectionTotals } from '@/lib/copywriting'
import type { CopywritingLengthUnit } from '@/types'

export interface StructureItem {
  /** Per-row id: the same library section can be used more than once. */
  key: string
  sectionId: string
  name: string
  /** What the section label means (the admin's definition for the AI); may be empty. */
  description: string
  /** The length, kept as typed so a half-entered number isn't rewritten under the cursor. */
  target: string
  /** Characters (default) or words. */
  unit: CopywritingLengthUnit
}

interface Props {
  library: { id: string; name: string; description?: string }[]
  value: StructureItem[]
  onChange: (items: StructureItem[]) => void
  /** Show per-row validation (after the first submit attempt). */
  showErrors?: boolean
}

const DRAG_TYPE = 'application/x-copywriting-section'
// The library's search box only earns its place once the list is long.
const SEARCH_FROM = 10

type DragPayload = { from: 'library'; sectionId: string } | { from: 'structure'; key: string }

export function sectionLengthError(raw: string, unit: CopywritingLengthUnit = 'characters'): string | null {
  if (!raw.trim()) return `Enter the number of ${unit}`
  const n = Number(raw)
  if (!Number.isInteger(n)) return 'Use a whole number'
  if (n < 1) return 'Enter a number above 0'
  return null
}

function itemTotals(items: StructureItem[]) {
  return sectionTotals(items.map((it) => ({ unit: it.unit, target: Number.isFinite(Number(it.target)) ? Number(it.target) : 0 })))
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// Builds an article's section structure from the admin's section library:
// drag a section in (or press +), order the rows by dragging their handle
// (or with the arrow keys / buttons), and give each one its length in
// characters right where it was dropped.
export default function SectionStructureBuilder({ library, value, onChange, showErrors = false }: Props) {
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState<DragPayload | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [armedKey, setArmedKey] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const charInputs = useRef(new Map<string, HTMLInputElement>())
  const handleRefs = useRef(new Map<string, HTMLButtonElement>())

  const atLimit = value.length >= MAX_ARTICLE_SECTIONS
  const totals = itemTotals(value)
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of value) m.set(it.sectionId, (m.get(it.sectionId) || 0) + 1)
    return m
  }, [value])
  const visibleLibrary = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? library.filter((s) => s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)) : library
  }, [library, query])

  // A section that was just added gets its characters field focused, so the
  // writer types the length straight away.
  useEffect(() => {
    if (!focusKey) return
    charInputs.current.get(focusKey)?.focus()
    setFocusKey(null)
  }, [focusKey, value])

  function insertAt(section: { id: string; name: string; description?: string }, index: number) {
    if (atLimit) return
    const item: StructureItem = { key: newKey(), sectionId: section.id, name: section.name, description: section.description || '', target: '', unit: 'characters' }
    const next = [...value]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, item)
    onChange(next)
    setFocusKey(item.key)
    setAnnouncement(`${section.name} added as section ${Math.min(index, value.length) + 1} of ${next.length}.`)
  }

  function moveTo(key: string, index: number) {
    const from = value.findIndex((it) => it.key === key)
    if (from === -1) return
    let to = Math.max(0, Math.min(index, value.length))
    if (from < to) to -= 1 // removing the row first shifts everything after it up
    if (to === from) return
    const next = [...value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
    setAnnouncement(`${item.name} moved to position ${to + 1} of ${next.length}.`)
  }

  function remove(key: string) {
    const item = value.find((it) => it.key === key)
    onChange(value.filter((it) => it.key !== key))
    if (item) setAnnouncement(`${item.name} removed.`)
  }

  function setTarget(key: string, raw: string) {
    onChange(value.map((it) => (it.key === key ? { ...it, target: raw.replace(/[^\d]/g, '') } : it)))
  }

  // Switching the unit keeps the number as typed — the writer decides what it means.
  function setUnit(key: string, unit: CopywritingLengthUnit) {
    onChange(value.map((it) => (it.key === key ? { ...it, unit } : it)))
    charInputs.current.get(key)?.focus()
  }

  // Insertion point under the pointer: before the first row whose middle is
  // below it, else at the end.
  function indexFromPointer(clientY: number): number {
    for (let i = 0; i < value.length; i++) {
      const el = rowRefs.current.get(value[i].key)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return value.length
  }

  function readPayload(e: React.DragEvent): DragPayload | null {
    try {
      const raw = e.dataTransfer.getData(DRAG_TYPE)
      return raw ? (JSON.parse(raw) as DragPayload) : dragging
    } catch {
      return dragging
    }
  }

  function startDrag(e: React.DragEvent, payload: DragPayload) {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = payload.from === 'library' ? 'copy' : 'move'
    setDragging(payload)
  }

  function endDrag() {
    setDragging(null)
    setDropIndex(null)
    setArmedKey(null)
  }

  function onListDragOver(e: React.DragEvent) {
    if (!dragging && !e.dataTransfer.types.includes(DRAG_TYPE)) return
    if (dragging?.from === 'library' && atLimit) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dragging?.from === 'structure' ? 'move' : 'copy'
    setDropIndex(indexFromPointer(e.clientY))
  }

  function onListDrop(e: React.DragEvent) {
    e.preventDefault()
    const payload = readPayload(e)
    const index = dropIndex ?? value.length
    if (payload?.from === 'library') {
      const section = library.find((s) => s.id === payload.sectionId)
      if (section) insertAt(section, index)
    } else if (payload?.from === 'structure') {
      moveTo(payload.key, index)
    }
    endDrag()
  }

  function onHandleKey(e: React.KeyboardEvent, key: string, index: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const target = e.key === 'ArrowUp' ? index - 1 : index + 2 // moveTo() expects the slot *before* which to land
    if (target < 0 || target > value.length) return
    moveTo(key, target)
    // Keep focus on the handle so repeated presses keep moving the same row.
    requestAnimationFrame(() => handleRefs.current.get(key)?.focus())
  }

  // Where a dragged section will land: a line at the top of row i, or after
  // the last row when i === value.length.
  const dropLine = (i: number) =>
    dragging && dropIndex === i ? (
      <span aria-hidden className={`pointer-events-none absolute left-0 right-0 z-10 flex items-center ${i === value.length ? '-bottom-[6px]' : '-top-[6px]'}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-black" />
        <span className="h-0.5 flex-1 bg-black" />
      </span>
    ) : null

  return (
    <div className="border border-[#e5e3df] bg-white">
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      {/* ── Section library ─────────────────────────────────────────── */}
      <div className="border-b border-[#e5e3df] bg-[#faf9f7] px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Section library</p>
          {library.length >= SEARCH_FROM && (
            <label className="flex items-center gap-1.5 border border-[#e5e3df] bg-white px-2 py-1 focus-within:border-black">
              <Search size={11} className="text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a section"
                aria-label="Find a section"
                className="w-32 bg-transparent text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none"
              />
            </label>
          )}
        </div>

        {library.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">
            No sections in the library yet. An admin can add them under Copywriting Tool → Admin → Sections.
          </p>
        ) : (
          <>
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Sections you can add">
              {visibleLibrary.map((s) => {
                const used = usage.get(s.id) || 0
                return (
                  <li key={s.id}>
                    <div
                      draggable={!atLimit}
                      onDragStart={(e) => startDrag(e, { from: 'library', sectionId: s.id })}
                      onDragEnd={endDrag}
                      title={s.description ? `${s.name}: ${s.description}` : s.name}
                      className={`group flex items-center gap-1 border bg-white py-1 pl-1.5 pr-1 text-xs text-gray-800 transition-colors ${
                        atLimit ? 'cursor-not-allowed border-[#e5e3df] opacity-50' : 'cursor-grab border-[#e5e3df] hover:border-gray-400 active:cursor-grabbing'
                      }`}
                    >
                      <GripVertical size={11} className="text-gray-300 group-hover:text-gray-400" aria-hidden />
                      <span className="select-none">{s.name}</span>
                      {used > 0 && (
                        <span className="rounded-full bg-gray-900 px-1.5 text-[9px] font-semibold leading-4 text-white" title={`Used ${used}× in this article`}>
                          {used}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => insertAt(s, value.length)}
                        disabled={atLimit}
                        className="ml-0.5 flex h-5 w-5 items-center justify-center text-gray-400 transition-colors hover:bg-gray-100 hover:text-black disabled:pointer-events-none"
                        aria-label={`Add ${s.name} to the end of the article`}
                        title="Add to the end"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </li>
                )
              })}
              {visibleLibrary.length === 0 && <li className="text-xs text-gray-400">No section matches “{query}”.</li>}
            </ul>
            <p className="mt-2 text-[11px] text-gray-400">
              Drag a section into the structure below, or press + to add it at the end. Hover a section to see what it is. A section can be used more than once.
            </p>
          </>
        )}
      </div>

      {/* ── Article structure ───────────────────────────────────────── */}
      <div className="px-4 py-4 sm:px-5" onDragOver={onListDragOver} onDrop={onListDrop}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null)
        }}
      >
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Article structure</p>

        {value.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center border border-dashed px-6 py-10 text-center transition-colors ${
              dragging?.from === 'library' ? 'border-black bg-[#faf9f7]' : showErrors ? 'border-red-300' : 'border-[#d9d6d0]'
            }`}
          >
            <LayoutList size={18} className={dragging ? 'text-gray-700' : 'text-gray-300'} />
            <p className="mt-2 text-sm text-gray-700">{dragging ? 'Drop to add it here' : 'Drag sections here to build the article'}</p>
            <p className="mt-0.5 text-xs text-gray-400">Then give each one its length, in characters or words.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Article structure, in reading order">
            <AnimatePresence initial={false}>
              {value.map((it, i) => {
                const err = sectionLengthError(it.target, it.unit)
                const invalid = showErrors && !!err
                const isDragged = dragging?.from === 'structure' && dragging.key === it.key
                return (
                  <motion.li
                    key={it.key}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: isDragged ? 0.4 : 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    ref={(el: HTMLLIElement | null) => {
                      if (el) rowRefs.current.set(it.key, el)
                      else rowRefs.current.delete(it.key)
                    }}
                    className="relative"
                  >
                    {dropLine(i)}
                    {i === value.length - 1 && dropLine(value.length)}
                    {/* Native drag lives on this plain element: framer-motion
                        claims onDragStart on its own components. The row is
                        only draggable while its handle is pressed, so the
                        characters field still selects text normally. */}
                    <div
                      draggable={armedKey === it.key}
                      onDragStart={(e) => startDrag(e, { from: 'structure', key: it.key })}
                      onDragEnd={endDrag}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border bg-white px-2.5 py-2 sm:flex-nowrap ${
                        invalid ? 'border-red-300' : 'border-[#e5e3df]'
                      }`}
                    >
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) handleRefs.current.set(it.key, el)
                          else handleRefs.current.delete(it.key)
                        }}
                        onPointerDown={() => setArmedKey(it.key)}
                        onPointerUp={() => setArmedKey(null)}
                        onKeyDown={(e) => onHandleKey(e, it.key, i)}
                        className="flex h-7 w-5 flex-shrink-0 cursor-grab items-center justify-center text-gray-300 transition-colors hover:text-gray-600 focus:text-gray-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-black active:cursor-grabbing"
                        aria-label={`Reorder ${it.name}. Use the arrow keys to move it up or down.`}
                        title="Drag to reorder"
                      >
                        <GripVertical size={14} />
                      </button>
                      <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 px-1.5 text-[10px] font-semibold tabular-nums text-white">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{it.name}</p>
                        {it.description && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-500" title={it.description}>
                            {it.description}
                          </p>
                        )}
                      </div>

                      <div className="order-last flex w-full flex-shrink-0 items-start gap-1.5 pl-8 sm:order-none sm:w-auto sm:pl-0">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <label
                              className={`flex items-center border bg-white focus-within:border-black ${invalid ? 'border-red-400' : 'border-[#e5e3df]'}`}
                            >
                              <input
                                ref={(el) => {
                                  if (el) charInputs.current.set(it.key, el)
                                  else charInputs.current.delete(it.key)
                                }}
                                inputMode="numeric"
                                value={it.target}
                                onChange={(e) => setTarget(it.key, e.target.value)}
                                placeholder="0"
                                aria-label={`Length of ${it.name}, in ${it.unit}`}
                                aria-invalid={invalid}
                                title={`Length in ${it.unit}`}
                                className="w-14 bg-transparent px-1.5 py-1 text-right text-xs tabular-nums text-gray-900 placeholder:text-gray-300 focus:outline-none"
                              />
                            </label>
                            {/* Characters (default) or words — chosen per section. */}
                            <div role="radiogroup" aria-label={`Measure ${it.name} in`} className="flex overflow-hidden rounded-full border border-[#e5e3df] bg-white p-0.5">
                              {(['characters', 'words'] as const).map((u) => (
                                <button
                                  key={u}
                                  type="button"
                                  role="radio"
                                  aria-checked={it.unit === u}
                                  onClick={() => setUnit(it.key, u)}
                                  title={u === 'characters' ? 'Characters, spaces included' : 'Words'}
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium leading-4 transition-colors ${
                                    it.unit === u ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'
                                  }`}
                                >
                                  {u === 'characters' ? 'Chars' : 'Words'}
                                </button>
                              ))}
                            </div>
                          </div>
                          {invalid && <span className="mt-0.5 text-[10px] text-red-500">{err}</span>}
                        </div>

                        <div className="ml-auto flex items-center sm:ml-0">
                          <button
                            type="button"
                            onClick={() => moveTo(it.key, i - 1)}
                            disabled={i === 0}
                            className="p-1 text-gray-400 transition-colors hover:text-black disabled:opacity-25"
                            aria-label={`Move ${it.name} up`}
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTo(it.key, i + 2)}
                            disabled={i === value.length - 1}
                            className="p-1 text-gray-400 transition-colors hover:text-black disabled:opacity-25"
                            aria-label={`Move ${it.name} down`}
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(it.key)}
                            className="p-1 text-gray-300 transition-colors hover:text-red-500"
                            aria-label={`Remove ${it.name}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
            {dragging?.from === 'library' && !atLimit && (
              <li aria-hidden className="border border-dashed border-[#d9d6d0] py-2 text-center text-[11px] text-gray-400">
                Drop anywhere in the list
              </li>
            )}
          </ol>
        )}
      </div>

      {/* ── Totals ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5e3df] bg-[#faf9f7] px-4 py-2.5 sm:px-5">
        <p className="text-xs text-gray-600">
          <span className="font-medium text-gray-900">{value.length}</span> section{value.length === 1 ? '' : 's'}
          {atLimit && <span className="text-gray-400"> (maximum)</span>}
        </p>
        <p className="text-xs tabular-nums text-gray-600">
          <span className="font-medium text-gray-900">{totals.label}</span>
        </p>
      </div>
    </div>
  )
}
