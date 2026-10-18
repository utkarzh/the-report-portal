'use client'

import { useEffect, useState } from 'react'

type Version = { id: string; prompt_text: string; created_at: string }

export default function CiPromptEditor() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const r = await fetch('/api/country-intel/prompt')
    const j = await r.json()
    if (!r.ok) { setMsg(j.error || 'Could not load the prompt'); return }
    setText(j.prompt_text); setSaved(j.prompt_text); setIsDefault(j.is_default); setVersions(j.versions)
  }
  useEffect(() => { load() }, [])

  async function save() {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/country-intel/prompt', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt_text: text }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg(j.error || 'Save failed'); return }
    setMsg('Saved. New runs use this prompt from their next step.')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500"><span>{isDefault ? 'Built-in default (TRC Country Intelligence system prompt)' : 'Custom prompt'}</span><span>{text.split(/\s+/).filter(Boolean).length} words</span></div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} className="h-[520px] w-full rounded-lg border border-[#e5e3df] p-3 font-mono text-xs leading-relaxed focus:border-gray-900 focus:outline-none" />
        <div className="mt-3 flex items-center gap-3">
          <button disabled={busy || text === saved} onClick={save} className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save prompt'}</button>
          {text !== saved && <button onClick={() => setText(saved)} className="text-sm text-gray-500 hover:text-black">Discard changes</button>}
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </div>
      {versions.length > 0 && (
        <div className="rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">Version history</p>
          <ul className="divide-y divide-[#efede9] text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-gray-600">{new Date(v.created_at).toLocaleString('en-GB')} · {v.prompt_text.split(/\s+/).length} words</span>
                <button onClick={() => { setText(v.prompt_text); setMsg('Loaded an earlier version into the editor — save to restore it.') }} className="text-xs text-gray-600 underline hover:text-black">Load into editor</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
