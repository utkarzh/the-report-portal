'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, CircleDashed, ExternalLink, FileText, Loader2, Mail, Sparkles } from 'lucide-react'
import { API_PATH } from '@/lib/commercial-presentations'
import {
  generateEditorialBrief,
  generateInterviewLetter,
  runEditorialBriefToCompletion,
  type LetterSender,
} from '@/lib/commercial-presentation-generators'
import type { WorkspaceApi } from './PresentationWorkspace'
import { Card, CardHeader, FieldLabel, PrimaryButton, SecondaryButton, inputClass } from './ui'

// Step 1 — Project intelligence (brief §10): Check → Fetch or Generate →
// Save if generated → (later) pass the content to Claude. The status of each
// asset is always visible: Retrieved ✓ / Generated ✓ / Generating… / Missing.

interface Candidate {
  id: string
  title: string
  country: string | null
  media: string | null
  status: string
  createdAt: string
  createdBy: string | null
  sameMedia: boolean
}

type Kind = 'brief' | 'letter'

function StatusLine({ ok, generating, label }: { ok: boolean; generating?: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-emerald-700' : generating ? 'text-amber-700' : 'text-gray-500'}`}>
      {generating ? <Loader2 size={13} className="animate-spin" /> : ok ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
      {label}
    </span>
  )
}

function CandidatePicker({
  presentationId,
  kind,
  onPick,
  onClose,
}: {
  presentationId: string
  kind: Kind
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<Candidate[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`${API_PATH}/${presentationId}/sources`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => !cancelled && setItems((kind === 'brief' ? d.briefs : d.letters) || []))
      .catch(() => !cancelled && setLoadError('Could not load the list.'))
    return () => {
      cancelled = true
    }
  }, [presentationId, kind])
  return (
    <div className="mt-3 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-gray-700">{kind === 'brief' ? 'Editorial Briefs for this country' : 'Interview Letters for this country'}</p>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-black">
          Cancel
        </button>
      </div>
      {loadError && <p className="text-xs text-red-600">{loadError}</p>}
      {!items && !loadError && <Loader2 size={14} className="animate-spin text-gray-400" />}
      {items && items.length === 0 && <p className="text-xs text-gray-500">None found. Generate one instead.</p>}
      <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
        {items?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent bg-white px-3 py-2 text-left text-xs hover:border-gray-300"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-800">{c.title}</span>
                <span className="block text-gray-500">
                  {[c.media, c.createdBy, new Date(c.createdAt).toLocaleDateString('en-GB')].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex flex-shrink-0 flex-col items-end gap-1">
                {c.sameMedia && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">Same media</span>}
                <span className="text-[10px] text-gray-400">{c.status}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function SourcesPanel({ api, currentUserName }: { api: WorkspaceApi; currentUserName: string }) {
  const { state, mutate, refresh, setError } = api
  const { project, sources, permissions } = state
  const canEdit = permissions.canEdit
  const [picking, setPicking] = useState<Kind | null>(null)
  const [progress, setProgress] = useState<{ kind: Kind; message: string } | null>(null)
  const [senderOpen, setSenderOpen] = useState(false)
  const [sender, setSender] = useState<LetterSender>({ name: currentUserName, title: '', contact: '' })
  const [research, setResearch] = useState(project.approved_research)
  const [savingResearch, setSavingResearch] = useState(false)

  const busy = progress !== null

  async function pick(kind: Kind, id: string | null) {
    setPicking(null)
    await mutate('/sources', 'POST', { kind, id, source: 'attached' })
  }

  async function run(kind: Kind, fn: (onProgress: (m: string) => void) => Promise<unknown>) {
    setError(null)
    setProgress({ kind, message: 'Starting…' })
    try {
      await fn((message) => setProgress({ kind, message }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setProgress(null)
      await refresh()
    }
  }

  const briefIncomplete = sources.brief && sources.brief.status !== 'complete'
  // Letters are written for the project's agency (its code in the central
  // agency list); Interview Letters says so if that agency has no templates yet.
  const letterCompany = state.agency?.code ?? null

  return (
    <Card>
      <CardHeader
        step="Step 1"
        title="Project intelligence"
        description="The Editorial Brief and the Interview Request Letter are the main sources for Why [Country] Now. If the project already has them they're retrieved; otherwise generate them here with the existing Editorial Brief and Interview Letter tools. They're saved to the project and reused."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Editorial Brief */}
        <div className="rounded-xl border border-[#e5e3df] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
            <FileText size={15} /> Editorial Brief
          </div>
          {progress?.kind === 'brief' ? (
            <StatusLine ok={false} generating label={progress.message} />
          ) : sources.brief ? (
            <div className="flex flex-col gap-1.5">
              <StatusLine
                ok={!briefIncomplete}
                generating={false}
                label={briefIncomplete ? 'Unfinished — resume to complete it' : sources.brief.source === 'generated' ? 'Generated ✓' : 'Retrieved ✓'}
              />
              <Link href={`/editorial-briefs/${sources.brief.id}`} className="inline-flex items-center gap-1 text-xs text-gray-600 underline hover:text-black" target="_blank">
                {sources.brief.title} <ExternalLink size={11} />
              </Link>
            </div>
          ) : (
            <StatusLine ok={false} label="Not attached yet" />
          )}
          {canEdit && !busy && (
            <div className="mt-3 flex flex-wrap gap-2">
              {briefIncomplete && (
                <PrimaryButton
                  icon={<Sparkles size={14} />}
                  onClick={() => run('brief', (p) => runEditorialBriefToCompletion(sources.brief!.id, p, { startWithContinue: true }))}
                >
                  Resume generation
                </PrimaryButton>
              )}
              {!sources.brief && (
                <PrimaryButton
                  icon={<Sparkles size={14} />}
                  onClick={() =>
                    run('brief', (p) => generateEditorialBrief({ presentationId: state.presentation.id, project, mediaCountry: state.mediaCountry, onProgress: p }))
                  }
                >
                  Generate brief
                </PrimaryButton>
              )}
              <SecondaryButton onClick={() => setPicking(picking === 'brief' ? null : 'brief')}>{sources.brief ? 'Change' : 'Use an existing brief'}</SecondaryButton>
              {sources.brief && <SecondaryButton onClick={() => pick('brief', null)}>Remove</SecondaryButton>}
            </div>
          )}
          {picking === 'brief' && <CandidatePicker presentationId={state.presentation.id} kind="brief" onPick={(id) => pick('brief', id)} onClose={() => setPicking(null)} />}
          {progress?.kind === 'brief' && <p className="mt-2 text-[11px] text-gray-500">This takes a few minutes. Keep this tab open; if it closes, come back and press Resume.</p>}
        </div>

        {/* Interview Request Letter */}
        <div className="rounded-xl border border-[#e5e3df] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-900">
            <Mail size={15} /> Interview Request Letter
          </div>
          {progress?.kind === 'letter' ? (
            <StatusLine ok={false} generating label={progress.message} />
          ) : sources.letter ? (
            <div className="flex flex-col gap-1.5">
              <StatusLine
                ok
                label={`${sources.letter.source === 'generated' ? 'Generated ✓' : 'Retrieved ✓'}${sources.letter.reviewed ? '' : ' — not reviewed yet'}`}
              />
              <Link href={`/interview-letters/${sources.letter.id}`} className="inline-flex items-center gap-1 text-xs text-gray-600 underline hover:text-black" target="_blank">
                Open the letter <ExternalLink size={11} />
              </Link>
            </div>
          ) : (
            <StatusLine ok={false} label="Not attached yet" />
          )}
          {canEdit && !busy && (
            <div className="mt-3 flex flex-wrap gap-2">
              {!sources.letter && (
                <PrimaryButton
                  icon={<Sparkles size={14} />}
                  disabled={!letterCompany}
                  title={letterCompany ? undefined : 'This project has no agency. Attach an existing letter instead.'}
                  onClick={() => setSenderOpen(true)}
                >
                  Generate letter
                </PrimaryButton>
              )}
              <SecondaryButton onClick={() => setPicking(picking === 'letter' ? null : 'letter')}>{sources.letter ? 'Change' : 'Use an existing letter'}</SecondaryButton>
              {sources.letter && <SecondaryButton onClick={() => pick('letter', null)}>Remove</SecondaryButton>}
            </div>
          )}
          {!sources.brief && !sources.letter && canEdit && (
            <p className="mt-2 text-[11px] text-gray-500">Tip: generate the brief first; the letter then uses it as research.</p>
          )}
          {picking === 'letter' && <CandidatePicker presentationId={state.presentation.id} kind="letter" onPick={(id) => pick('letter', id)} onClose={() => setPicking(null)} />}
          {senderOpen && !busy && (
            <div className="mt-3 flex flex-col gap-3 rounded-xl border border-[#e5e3df] bg-[#faf9f7] p-3">
              <p className="text-xs text-gray-600">The letter&apos;s cover email is signed by:</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="sender-name">Sender name</FieldLabel>
                  <input id="sender-name" className={inputClass} value={sender.name} onChange={(e) => setSender({ ...sender, name: e.target.value })} />
                </div>
                <div>
                  <FieldLabel htmlFor="sender-title">Sender title</FieldLabel>
                  <input id="sender-title" className={inputClass} value={sender.title} placeholder="e.g. Country Director" onChange={(e) => setSender({ ...sender, title: e.target.value })} />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="sender-contact">Contact (optional)</FieldLabel>
                <input id="sender-contact" className={inputClass} value={sender.contact} onChange={(e) => setSender({ ...sender, contact: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <PrimaryButton
                  disabled={!sender.name.trim() || !sender.title.trim() || !letterCompany}
                  onClick={() => {
                    setSenderOpen(false)
                    run('letter', (p) =>
                      generateInterviewLetter({
                        presentationId: state.presentation.id,
                        company: letterCompany!,
                        project,
                        mediaCountry: state.mediaCountry,
                        sender,
                        onProgress: p,
                      }),
                    )
                  }}
                >
                  Generate letter
                </PrimaryButton>
                <SecondaryButton onClick={() => setSenderOpen(false)}>Cancel</SecondaryButton>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4">
        <FieldLabel htmlFor="approved-research">Approved project research (optional)</FieldLabel>
        <textarea
          id="approved-research"
          rows={4}
          className={inputClass}
          disabled={!canEdit}
          value={research}
          placeholder="Paste any research the team has already verified for this project."
          onChange={(e) => setResearch(e.target.value)}
        />
        {canEdit && research !== project.approved_research && (
          <div className="mt-2">
            <SecondaryButton
              loading={savingResearch}
              onClick={async () => {
                setSavingResearch(true)
                await mutate('', 'PATCH', { project: { approvedResearch: research } })
                setSavingResearch(false)
              }}
            >
              Save research
            </SecondaryButton>
          </div>
        )}
      </div>
      <p className="mt-3 text-[11px] text-gray-500">
        {state.examplesCount > 0
          ? `${state.examplesCount} approved reference example${state.examplesCount === 1 ? '' : 's'} guide the style, never the facts.`
          : 'No approved reference examples yet. Admins can add them to guide the style.'}
      </p>
    </Card>
  )
}
