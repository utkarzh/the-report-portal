'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Upload, Trash2, Download } from 'lucide-react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { MEETING_PREP_RESOURCE_SLOTS, MEETING_PREP_SAMPLE_AUDIO_BUCKET, type MeetingPrepResourceSlot } from '@/lib/meeting-prep'

export interface SlotState {
  slot: MeetingPrepResourceSlot
  name: string | null
  size: number | null
  updatedAt: string | null
}

function formatSize(n: number | null): string {
  if (!n) return ''
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

// One row per apertura sample file: what it holds now, and Upload / Replace /
// Remove. The file goes straight from the browser to the private bucket
// (admin RLS), then the API deletes whatever the slot held before.
export default function PlanteoResourcesManager({ initial }: { initial: SlotState[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<MeetingPrepResourceSlot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputs = useRef<Partial<Record<MeetingPrepResourceSlot, HTMLInputElement | null>>>({})
  const bySlot = Object.fromEntries(initial.map((s) => [s.slot, s])) as Record<MeetingPrepResourceSlot, SlotState>

  async function upload(slot: MeetingPrepResourceSlot, file: File) {
    setError(null)
    setBusy(slot)
    try {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim() || 'file'
      const path = `resources/${slot}/${Date.now()}-${safe}`
      const supabase = getSupabaseBrowserClient()
      const { error: upErr } = await supabase.storage
        .from(MEETING_PREP_SAMPLE_AUDIO_BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) throw new Error(upErr.message)
      const res = await fetch('/api/meeting-prep/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot, storagePath: path }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Upload failed')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(null)
    }
  }

  async function remove(slot: MeetingPrepResourceSlot) {
    if (!confirm('Remove this file? Reps will no longer see it.')) return
    setError(null)
    setBusy(slot)
    try {
      const res = await fetch(`/api/meeting-prep/resources?slot=${slot}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Remove failed')
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {MEETING_PREP_RESOURCE_SLOTS.map((def) => {
        const cur = bySlot[def.slot]
        const isBusy = busy === def.slot
        return (
          <section key={def.slot} className="border border-[#e5e3df] bg-white p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#f7f6f3] text-gray-600"><FileText size={16} /></span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
                  <p className="mt-1 max-w-xl text-xs text-gray-500">Reps download it from the aperturador planteo (&ldquo;You can download {def.label.toLowerCase().replace(/^sample /, 'a sample ')} HERE&rdquo;).</p>
                  <p className="mt-2 text-[11px] text-gray-400">
                    {cur?.name
                      ? <>Current file: <span className="font-medium text-gray-600">{cur.name}</span>{cur.size ? ` · ${formatSize(cur.size)}` : ''}{cur.updatedAt ? ` · uploaded ${new Date(cur.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</>
                      : 'Nothing uploaded yet.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <input
                  ref={(el) => { inputs.current[def.slot] = el }}
                  type="file"
                  accept={def.accept}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void upload(def.slot, f)
                  }}
                />
                {cur?.name && (
                  <a href={`/api/meeting-prep/resources/${def.slot}/download`} className="inline-flex items-center gap-1.5 border border-[#e5e3df] px-3 py-2 text-xs font-medium text-gray-700 hover:border-gray-400">
                    <Download size={13} /> Download
                  </a>
                )}
                {cur?.name && (
                  <button type="button" disabled={isBusy} onClick={() => remove(def.slot)} className="inline-flex items-center gap-1.5 border border-[#e5e3df] px-3 py-2 text-xs font-medium text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-40">
                    <Trash2 size={13} /> Remove
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => inputs.current[def.slot]?.click()}
                  className="inline-flex items-center gap-1.5 bg-black px-4 py-2 text-xs font-medium uppercase tracking-wider text-white hover:bg-gray-900 disabled:opacity-50"
                >
                  <Upload size={13} /> {isBusy ? 'Working…' : cur?.name ? 'Replace' : 'Upload'}
                </button>
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
