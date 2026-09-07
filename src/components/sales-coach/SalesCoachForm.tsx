'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Upload, FileAudio, FileText, Loader2 } from 'lucide-react'
import Input from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import Textarea from '@/components/ui/Textarea'
import Button from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { SALES_COACH_OUTCOMES } from '@/lib/sales-coach'
import type { SalesCoachOutcome, SalesCoachParticipant } from '@/types'

const AUDIO_BUCKET = 'sales-coach-audio'
const MAX_BYTES = 500 * 1024 * 1024

type Phase = 'idle' | 'transcoding' | 'uploading' | 'creating' | 'error'
type InputMode = 'audio' | 'transcript'

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'other']

export default function SalesCoachForm({ userId }: { userId: string }) {
  const router = useRouter()
  const audioRef = useRef<HTMLInputElement>(null)

  // Step 1 — contextual form (US-034)
  const [ctx, setCtx] = useState({
    country: '', mediaPublication: '', company: '',
    intervieweeName: '', intervieweePosition: '', otherComments: '',
  })
  const [companyReps, setCompanyReps] = useState<SalesCoachParticipant[]>([{ name: '', role: '' }])
  const [trcMembers, setTrcMembers] = useState<SalesCoachParticipant[]>([{ name: '', role: '' }])

  // Step 2 — upload (US-035)
  const [inputMode, setInputMode] = useState<InputMode>('audio')
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [transcript, setTranscript] = useState('')

  // Step 3 — declared outcome (US-036)
  const [outcome, setOutcome] = useState<SalesCoachOutcome | ''>('')
  const [details, setDetails] = useState<Record<string, string | boolean>>({})

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const busy = phase !== 'idle' && phase !== 'error'

  function setC(k: keyof typeof ctx, v: string) { setCtx((p) => ({ ...p, [k]: v })) }
  function setD(k: string, v: string | boolean) { setDetails((p) => ({ ...p, [k]: v })) }

  function pickAudio(f: File | null | undefined) {
    if (!f) return
    setError(null)
    if (f.size > MAX_BYTES) { setError('That file is too large (max 500 MB).'); return }
    setAudioFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)

    if (!outcome) { setError('Please declare the final outcome of this negotiation.'); return }
    if (inputMode === 'audio' && !audioFile) { setError('Upload the audio recording, or switch to “Paste transcript”.'); return }
    if (inputMode === 'transcript' && !transcript.trim()) { setError('Paste the transcript, or switch to “Upload audio”.'); return }

    // Outcome-conditional required fields (US-036).
    if (outcome === 'signed' && (!details.space || !details.price || !details.currency)) {
      setError('For “Signed on the spot”, enter the space/product, price and currency.'); return
    }
    if (outcome === 'retorno' && !details.noneEstablished) {
      if (details.opt1Space && (!details.opt1Price || !details.opt1Currency)) {
        setError('Option 1 has a space/product — please add its price and currency (or mark none established).'); return
      }
      if (details.opt2Space && (!details.opt2Price || !details.opt2Currency)) {
        setError('Option 2 has a space/product — please add its price and currency.'); return
      }
    }

    try {
      let audioPath: string | undefined
      let audioMime: string | undefined
      let originalFilename: string | undefined

      if (inputMode === 'audio' && audioFile) {
        originalFilename = audioFile.name
        audioMime = 'audio/mpeg'
        const supabase = getSupabaseBrowserClient()
        const groupId = crypto.randomUUID()

        // Compress in-browser to a compact 16kHz mono MP3 — reuses the exact
        // transcode step the Transcription module uses (US-037).
        setPhase('transcoding')
        const { transcodeToMp3 } = await import('@/lib/ffmpeg-client')
        const { blob } = await transcodeToMp3(audioFile, { onProgress: (r) => setProgress(r) })

        audioPath = `${userId}/${groupId}/audio.mp3`
        setPhase('uploading')
        const { error: upErr } = await supabase.storage.from(AUDIO_BUCKET).upload(audioPath, blob, { contentType: 'audio/mpeg', upsert: false })
        if (upErr) throw new Error('Upload failed. Please try again.')
      }

      setPhase('creating')
      const res = await fetch('/api/sales-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ctx,
          companyReps, trcMembers,
          audioPath, audioMime, originalFilename,
          uploadedTranscript: inputMode === 'transcript' ? transcript : undefined,
          declaredOutcome: outcome,
          outcomeDetails: details,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.id) throw new Error(data.error || 'Could not submit. Please try again.')
      router.push(`/sales-coach/${data.id}`)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  const statusLabel =
    phase === 'transcoding' ? `Processing audio… ${Math.round(progress * 100)}%`
    : phase === 'uploading' ? 'Uploading audio…'
    : phase === 'creating' ? 'Submitting…'
    : 'Submit negotiation'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* ── Step 1: context ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[#e5e3df] bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">Context</h2>
        <p className="mt-1 text-xs text-gray-500">
          This information helps the coach identify the participants, understand the commercial context and interpret the audio accurately.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input label="Country" value={ctx.country} onChange={(e) => setC('country', e.target.value)} placeholder="e.g. Italy" />
          <Input label="Media / Publication" value={ctx.mediaPublication} onChange={(e) => setC('mediaPublication', e.target.value)} placeholder="e.g. Die Welt" />
          <Input label="Company" value={ctx.company} onChange={(e) => setC('company', e.target.value)} placeholder="e.g. Acme Corp" />
          <Input label="Interviewee name" value={ctx.intervieweeName} onChange={(e) => setC('intervieweeName', e.target.value)} placeholder="e.g. Jane Doe" />
          <Input label="Interviewee position" value={ctx.intervieweePosition} onChange={(e) => setC('intervieweePosition', e.target.value)} placeholder="e.g. CEO" />
        </div>

        <ParticipantList
          title="Company representatives present"
          nameLabel="Name"
          roleLabel="Position"
          items={companyReps}
          setItems={setCompanyReps}
        />
        <ParticipantList
          title="TRC team members present"
          nameLabel="Name"
          roleLabel="Role"
          items={trcMembers}
          setItems={setTrcMembers}
        />

        <div className="mt-4">
          <Textarea label="Other contextual comments" hint="optional" rows={3} value={ctx.otherComments} onChange={(e) => setC('otherComments', e.target.value)} />
        </div>
      </section>

      {/* ── Step 2: upload ──────────────────────────────────────────── */}
      <section className="rounded-2xl border border-[#e5e3df] bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">Recording or transcript</h2>
        <div className="mt-3 flex gap-2">
          <TabButton active={inputMode === 'audio'} onClick={() => setInputMode('audio')} icon={<FileAudio size={14} />} label="Upload audio" />
          <TabButton active={inputMode === 'transcript'} onClick={() => setInputMode('transcript')} icon={<FileText size={14} />} label="Paste transcript" />
        </div>

        {inputMode === 'audio' ? (
          <div className="mt-4">
            {audioFile ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#e5e3df] bg-[#fcfbf8] px-4 py-3">
                <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800"><FileAudio size={15} className="text-gray-500" /><span className="truncate">{audioFile.name}</span></span>
                {!busy && <button type="button" onClick={() => { setAudioFile(null); if (audioRef.current) audioRef.current.value = '' }} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>}
              </div>
            ) : (
              <button type="button" onClick={() => audioRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-[#d4d0c8] bg-[#fcfbf8] px-6 py-8 text-sm text-gray-600 hover:border-gray-400">
                <Upload size={18} /> Drop or choose an audio file
                <span className="text-xs text-gray-400">MP3, WAV, M4A, WEBM · long recordings supported</span>
              </button>
            )}
            <input ref={audioRef} type="file" accept="audio/*" className="sr-only" onChange={(e) => pickAudio(e.target.files?.[0])} />
            {(phase === 'transcoding' || phase === 'uploading') && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#efece7]"><div className="h-full rounded-full bg-black transition-all" style={{ width: phase === 'transcoding' ? `${Math.round(progress * 100)}%` : '100%' }} /></div>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <Textarea label="Transcript" rows={8} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Paste the existing transcript here…" />
          </div>
        )}
      </section>

      {/* ── Step 3: declared outcome ────────────────────────────────── */}
      <section className="rounded-2xl border border-[#e5e3df] bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">What was the final outcome of this negotiation? *</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {SALES_COACH_OUTCOMES.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { setOutcome(o.value); setDetails({}) }}
              className={`rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${outcome === o.value ? 'border-black bg-[#faf9f7]' : 'border-[#e5e3df] hover:border-gray-300'}`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Conditional fields per the declared outcome (US-036) */}
        {outcome === 'signed' && (
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Input label="Space / product signed *" value={s(details.space)} onChange={(e) => setD('space', e.target.value)} placeholder="e.g. Half page" />
            <Input label="Price *" value={s(details.price)} onChange={(e) => setD('price', e.target.value)} placeholder="e.g. 30000" />
            <CurrencySelect value={s(details.currency)} onChange={(v) => setD('currency', v)} />
          </div>
        )}

        {outcome === 'retorno' && (
          <div className="mt-5 flex flex-col gap-4">
            <p className="rounded-lg border border-[#e5e3df] bg-[#faf9f7] px-3 py-2 text-xs text-gray-600">
              Enter a maximum of two specific options discussed with the CEO. If no specific space and price were established, select “No specific space and price were established.” More than two unresolved options does not provide a reliable commercial basis for a retorno and will be evaluated by the coach accordingly.
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={Boolean(details.noneEstablished)} onChange={(e) => setD('noneEstablished', e.target.checked)} />
              No specific space and price were established
            </label>
            {!details.noneEstablished && (
              <>
                <div className="rounded-xl border border-[#e5e3df] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Option 1</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Input label="Space / product" value={s(details.opt1Space)} onChange={(e) => setD('opt1Space', e.target.value)} />
                    <Input label="Price" value={s(details.opt1Price)} onChange={(e) => setD('opt1Price', e.target.value)} />
                    <CurrencySelect value={s(details.opt1Currency)} onChange={(v) => setD('opt1Currency', v)} />
                  </div>
                </div>
                <div className="rounded-xl border border-[#e5e3df] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Option 2 <span className="font-normal normal-case text-gray-400">(optional)</span></p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Input label="Space / product" value={s(details.opt2Space)} onChange={(e) => setD('opt2Space', e.target.value)} />
                    <Input label="Price" value={s(details.opt2Price)} onChange={(e) => setD('opt2Price', e.target.value)} />
                    <CurrencySelect value={s(details.opt2Currency)} onChange={(v) => setD('opt2Currency', v)} />
                  </div>
                </div>
              </>
            )}
            <div className="rounded-xl border border-[#e5e3df] p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Follow-up <span className="font-normal normal-case text-gray-400">(all optional — leave blank if not secured)</span></p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Next decision-maker / signatory name" value={s(details.nextDmName)} onChange={(e) => setD('nextDmName', e.target.value)} />
                <Input label="Their position" value={s(details.nextDmPosition)} onChange={(e) => setD('nextDmPosition', e.target.value)} />
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(details.ceoIntroduced)} onChange={(e) => setD('ceoIntroduced', e.target.checked)} /> The CEO directly introduced or contacted them</label>
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(details.meetingAgreed)} onChange={(e) => setD('meetingAgreed', e.target.checked)} /> A further decision meeting was agreed</label>
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Input type="date" label="Meeting date" value={s(details.meetingDate)} onChange={(e) => setD('meetingDate', e.target.value)} />
                <Input type="time" label="Meeting time" value={s(details.meetingTime)} onChange={(e) => setD('meetingTime', e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {outcome === 'lost' && (
          <div className="mt-5">
            <Textarea label="Reason given by the client" hint="optional" rows={3} value={s(details.lostReason)} onChange={(e) => setD('lostReason', e.target.value)} />
          </div>
        )}

        {outcome === 'uncertain' && (
          <p className="mt-4 text-sm text-gray-500">No additional details required — the coach will assess the recorded evidence.</p>
        )}
      </section>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Every submission is saved under your account.</span>
        <Button type="submit" loading={busy} disabled={busy} arrow>{statusLabel}</Button>
      </div>
    </form>
  )
}

function s(v: unknown): string { return typeof v === 'string' ? v : '' }

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select label="Currency" value={value} onChange={(e) => onChange(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c.toUpperCase() }))} />
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${active ? 'border-black bg-black text-white' : 'border-[#e5e3df] text-gray-700 hover:border-gray-300'}`}>
      {icon}{label}
    </button>
  )
}

function ParticipantList({ title, nameLabel, roleLabel, items, setItems }: {
  title: string
  nameLabel: string
  roleLabel: string
  items: SalesCoachParticipant[]
  setItems: (v: SalesCoachParticipant[]) => void
}) {
  function update(i: number, k: keyof SalesCoachParticipant, v: string) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)))
  }
  return (
    <div className="mt-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      <div className="mt-2 flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1"><Input label={i === 0 ? nameLabel : ''} value={it.name} onChange={(e) => update(i, 'name', e.target.value)} placeholder="Name" /></div>
            <div className="flex-1"><Input label={i === 0 ? roleLabel : ''} value={it.role} onChange={(e) => update(i, 'role', e.target.value)} placeholder={roleLabel} /></div>
            <button type="button" onClick={() => setItems(items.length > 1 ? items.filter((_, idx) => idx !== i) : [{ name: '', role: '' }])} className="mb-2 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={15} /></button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setItems([...items, { name: '', role: '' }])} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black">
        <Plus size={13} /> Add another
      </button>
    </div>
  )
}
