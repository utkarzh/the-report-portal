'use client'

import { useRef, useState } from 'react'
import { Bold, Heading2, Heading3, Link2, List, ListOrdered } from 'lucide-react'
import { renderKbMarkdown } from '@/lib/knowledge/markdown'

// US-103: a simple editor — headings, lists, bold and links — that stores
// markdown (what the AI reads and the item page renders). Write/Preview tabs
// instead of a WYSIWYG library: no extra dependency, and long policies
// (3+ pages) stay fast to edit.
export default function MarkdownEditor({
  value,
  onChange,
  disabled,
  minRows = 18,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  function apply(fn: (selected: string) => { text: string; selectFrom?: number; selectTo?: number }, lineMode = false) {
    const el = ref.current
    if (!el) return
    let start = el.selectionStart
    let end = el.selectionEnd
    if (lineMode) {
      start = value.lastIndexOf('\n', start - 1) + 1
      const nl = value.indexOf('\n', end)
      end = nl === -1 ? value.length : nl
    }
    const selected = value.slice(start, end)
    const { text, selectFrom, selectTo } = fn(selected)
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + (selectFrom ?? text.length), start + (selectTo ?? text.length))
    })
  }

  const prefixLines = (prefix: (i: number) => string) => (s: string) => {
    const lines = (s || '').split('\n')
    return { text: lines.map((l, i) => `${prefix(i)}${l.replace(/^(#{1,6}\s|[-*]\s|\d+\.\s)/, '')}`).join('\n') }
  }

  const tools = [
    { icon: Heading2, label: 'Heading', run: () => apply(prefixLines(() => '## '), true) },
    { icon: Heading3, label: 'Subheading', run: () => apply(prefixLines(() => '### '), true) },
    {
      icon: Bold,
      label: 'Bold',
      run: () => apply((s) => ({ text: `**${s || 'bold text'}**`, selectFrom: 2, selectTo: 2 + (s || 'bold text').length })),
    },
    { icon: List, label: 'Bulleted list', run: () => apply(prefixLines(() => '- '), true) },
    { icon: ListOrdered, label: 'Numbered list', run: () => apply(prefixLines((i) => `${i + 1}. `), true) },
    {
      icon: Link2,
      label: 'Link',
      run: () => {
        const url = window.prompt('Link address (https://…)')
        if (!url) return
        apply((s) => ({ text: `[${s || 'link text'}](${url})`, selectFrom: 1, selectTo: 1 + (s || 'link text').length }))
      },
    },
  ]

  return (
    <div className="rounded-lg border border-[#e5e3df] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#e5e3df] px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          {tools.map(({ icon: Icon, label, run }) => (
            <button
              key={label}
              type="button"
              title={label}
              onClick={run}
              disabled={disabled || tab === 'preview'}
              className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black disabled:opacity-40"
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div className="flex rounded-md bg-gray-100 p-0.5 text-[11px] font-medium">
          {(['write', 'preview'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2.5 py-1 capitalize ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === 'write' ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={minRows}
          placeholder={'## Purpose\nWhat this guide covers…\n\n## Steps\n1. First step\n2. Second step'}
          className="block w-full resize-y rounded-b-lg px-4 py-3 font-mono text-[13px] leading-relaxed placeholder:text-gray-300 focus:outline-none disabled:bg-gray-50"
        />
      ) : (
        <div
          className="prose-research min-h-[300px] px-5 py-4 text-sm text-gray-800"
          dangerouslySetInnerHTML={{ __html: value.trim() ? renderKbMarkdown(value) : '<p class="text-gray-400">Nothing to preview yet.</p>' }}
        />
      )}
    </div>
  )
}
