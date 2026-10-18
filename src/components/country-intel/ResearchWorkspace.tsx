'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, FileSpreadsheet, Pause, Play, Radar, Trash2, CheckCircle2, AlertTriangle, Loader2, ChevronDown, ChevronRight, Phone, Smartphone, Mail } from 'lucide-react'
import StatusPill, { type PillTone } from '@/components/ui/StatusPill'
import { DEPTHS } from '@/lib/country-intel/depth'
import type { CiCompany, CiContactEntry, CiProject } from '@/lib/country-intel/types'

type Summary = {
  tasks: Record<string, { total: number; done: number; failed: number; running: number }>
  companies: { total: number; profiled: number; failed: number; passing: number; clientOutside: number; contactsDone: number; verified: number }
  recent: { id: string; kind: string; round: number; status: string; cost: number; searches: number; error: string | null; finished_at: string | null; size?: number }[]
}

const STATUS: Record<string, { label: string; tone: PillTone }> = {
  draft: { label: 'Not started', tone: 'stone' }, running: { label: 'Researching', tone: 'amber' }, paused: { label: 'Paused', tone: 'sky' },
  complete: { label: 'Complete', tone: 'emerald' }, failed: { label: 'Failed', tone: 'red' },
}
const PHASES = [
  { key: 'context_discovery', label: 'Discovery' }, { key: 'selecting', label: 'Selection' }, { key: 'profiling', label: 'Profiles' },
  { key: 'contacts', label: 'Contacts' }, { key: 'verifying', label: 'Verification' }, { key: 'done', label: 'Done' },
]
const KIND_LABEL: Record<string, string> = { context: 'Country context', collect: 'Discovery search', select: 'Selection', profile: 'Company profiles', contacts: 'Contact search', verify: 'Verification' }
const ok = (v?: string) => v === 'source' || v === 'website'

function Mark({ v }: { v?: string }) {
  if (ok(v)) return <span className="font-semibold text-emerald-700" title="Found on the company's own pages">✓</span>
  if (v === 'unconfirmed') return <span className="font-semibold text-amber-600" title="Not confirmed automatically — check before calling">⚠</span>
  return null
}

function ContactLine({ e }: { e: CiContactEntry }) {
  return (
    <div className="text-sm">
      <div><span className="font-medium text-gray-900">{e.name}</span> {e.kind === 'person' && <Mark v={e.checks.name} />}{e.role && <span className="text-gray-500">, {e.role}</span>}</div>
      <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-gray-700">
        {e.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{e.phone} <Mark v={e.checks.phone} /></span>}
        {e.mobile && <span className="inline-flex items-center gap-1"><Smartphone size={12} />{e.mobile} <Mark v={e.checks.mobile} /></span>}
        {e.email && <span className="inline-flex items-center gap-1"><Mail size={12} />{e.email} <Mark v={e.checks.email} /></span>}
      </div>
      {e.ask_for && <div className="text-xs text-gray-500">Ask for: {e.ask_for}</div>}
    </div>
  )
}

export default function ResearchWorkspace({ initialProject, initialSummary, autoRun }: { initialProject: CiProject; initialSummary: Summary; autoRun: boolean }) {
  const router = useRouter()
  const [project, setProject] = useState(initialProject)
  const [summary, setSummary] = useState(initialSummary)
  const [looping, setLooping] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [companies, setCompanies] = useState<CiCompany[] | null>(null)
  const [filter, setFilter] = useState<'pass' | 'outside' | 'pending' | 'all'>('pass')
  const [sector, setSector] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [budgetInput, setBudgetInput] = useState('')
  const stopRef = useRef(false)
  const lastCompaniesFetch = useRef(0)

  const loadCompanies = useCallback(async () => {
    lastCompaniesFetch.current = Date.now()
    const r = await fetch(`/api/country-intel/${project.id}/companies`)
    if (r.ok) setCompanies((await r.json()).companies)
  }, [project.id])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  const apply = (j: { project?: CiProject; summary?: Summary }) => { if (j.project) setProject(j.project); if (j.summary) setSummary(j.summary) }

  const loop = useCallback(async () => {
    if (looping) return
    setLooping(true); stopRef.current = false; setNote(null)
    let errors = 0
    while (!stopRef.current) {
      try {
        const t0 = Date.now()
        const r = await fetch(`/api/country-intel/${project.id}/step`, { method: 'POST' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || `Step failed (${r.status})`)
        errors = 0
        apply(j)
        if (Date.now() - lastCompaniesFetch.current > 40_000) loadCompanies()
        if (!j.project || j.project.status !== 'running') { loadCompanies(); break }
        // A step that returns at once did no work (another tab or a still-locked task
        // holds it): wait a moment rather than hammer the server.
        if (Date.now() - t0 < 3000) await new Promise((res) => setTimeout(res, 4000))
      } catch (e) {
        errors++
        setNote(`${e instanceof Error ? e.message : String(e)} — retrying…`)
        if (errors >= 4) { setNote('The research stopped responding. Press Resume to continue — progress is saved.'); break }
        await new Promise((res) => setTimeout(res, 5000))
      }
    }
    setLooping(false)
  }, [looping, project.id, loadCompanies])

  useEffect(() => {
    if ((autoRun || initialProject.status === 'running') && !looping) loop()
    return () => { stopRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function act(action: 'start' | 'pause' | 'resume', extra: Record<string, unknown> = {}) {
    setNote(null)
    const r = await fetch(`/api/country-intel/${project.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setNote(j.error || 'Action failed'); return }
    apply(j)
    if (action === 'pause') stopRef.current = true
    if (action !== 'pause') loop()
  }

  async function remove() {
    if (!confirm('Delete this research and all its companies? This cannot be undone.')) return
    const r = await fetch(`/api/country-intel/${project.id}`, { method: 'DELETE' })
    if (r.ok) router.push('/commercial/country-intelligence')
  }

  const st = STATUS[project.status] || STATUS.draft
  const budgetReached = String(project.error || '').startsWith('BUDGET:')
  const phaseIdx = PHASES.findIndex((p) => p.key === project.phase)
  const spentPct = Math.min(100, (Number(project.spent_usd) / Math.max(0.01, Number(project.budget_usd))) * 100)
  const t = summary.tasks
  const pct = (k: string) => (t[k]?.total ? Math.round(((t[k].done + t[k].failed) / t[k].total) * 100) : 0)

  const sectors = useMemo(() => [...new Set((companies || []).map((c) => c.sector || 'Other companies'))], [companies])
  const rows = useMemo(() => (companies || []).filter((c) => {
    if (filter === 'pass' && !c.verdict?.pass) return false
    if (filter === 'outside' && (c.status !== 'profiled' || c.verdict?.pass)) return false
    if (filter === 'pending' && c.status === 'profiled') return false
    if (sector !== 'all' && (c.sector || 'Other companies') !== sector) return false
    if (q && !`${c.name} ${c.profile?.name || ''} ${c.profile?.leader?.name || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }), [companies, filter, sector, q])

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/commercial/country-intelligence" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-black"><ArrowLeft size={14} /> Country Intelligence</Link>

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700"><Radar size={18} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-base font-semibold text-gray-900">{project.title}</h1><StatusPill label={budgetReached ? 'Budget reached' : st.label} tone={budgetReached ? 'red' : st.tone} pulse={project.status === 'running'} /></div>
            <p className="mt-1 text-sm text-gray-500">{project.country} · {DEPTHS[project.depth].label} depth · target {project.target_count} companies · revenue ≥ USD {Math.round(Number(project.min_revenue_usd) / 1e6)}M{project.local_hq_only ? ' · locally owned only' : ''}</p>
            {project.brief && <p className="mt-1 max-w-3xl text-xs text-gray-500">{project.brief}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {project.status === 'draft' && <button onClick={() => act('start')} className="inline-flex items-center gap-2 rounded-lg bg-black px-3.5 py-2 text-sm text-white hover:bg-gray-900"><Play size={14} /> Start research</button>}
          {project.status === 'running' && <button onClick={() => act('pause')} className="inline-flex items-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-sm hover:border-gray-900"><Pause size={14} /> Pause</button>}
          {(project.status === 'paused' || project.status === 'failed') && !budgetReached && <button onClick={() => act('resume')} className="inline-flex items-center gap-2 rounded-lg bg-black px-3.5 py-2 text-sm text-white hover:bg-gray-900"><Play size={14} /> Resume</button>}
          {project.status === 'running' && !looping && <button onClick={() => loop()} className="inline-flex items-center gap-2 rounded-lg bg-black px-3.5 py-2 text-sm text-white"><Play size={14} /> Continue here</button>}
          <a href={`/api/country-intel/${project.id}/export?format=pdf`} className={`inline-flex items-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-sm hover:border-gray-900 ${summary.companies.passing ? '' : 'pointer-events-none opacity-40'}`}><Download size={14} /> PDF report</a>
          <a href={`/api/country-intel/${project.id}/export?format=xlsx`} className={`inline-flex items-center gap-2 rounded-lg border border-[#e5e3df] bg-white px-3.5 py-2 text-sm hover:border-gray-900 ${summary.companies.passing ? '' : 'pointer-events-none opacity-40'}`}><FileSpreadsheet size={14} /> Excel</a>
          <button onClick={remove} className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-gray-400 hover:text-red-600" aria-label="Delete research"><Trash2 size={15} /></button>
        </div>
      </div>

      {(note || (project.error && !budgetReached)) && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{note || project.error}</div>}
      {budgetReached && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
          <span>The hard stop of ${Number(project.budget_usd).toFixed(2)} has been reached (${Number(project.spent_usd).toFixed(2)} spent). Raise it to continue — the run picks up exactly where it stopped.</span>
          <span className="flex gap-2"><input className="w-24 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-sm" inputMode="decimal" placeholder={(Number(project.budget_usd) * 1.5).toFixed(2)} value={budgetInput} onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d.]/g, ''))} />
            <button onClick={() => act('resume', { budgetUsd: Number(budgetInput || (Number(project.budget_usd) * 1.5).toFixed(2)) })} className="rounded-lg bg-black px-3 py-1.5 text-white">Raise & resume</button></span>
        </div>
      )}

      <div className="mb-5 grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Meeting the criteria</p><p className="mt-1 text-2xl font-semibold">{summary.companies.passing} <span className="text-sm font-normal text-gray-500">/ {project.target_count}</span></p><p className="text-xs text-gray-500">{summary.companies.profiled} profiled · {summary.companies.total} candidates{summary.companies.clientOutside ? ` · ${summary.companies.clientOutside} client-named outside` : ''}</p></div>
        <div className="rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Contacts</p><p className="mt-1 text-2xl font-semibold">{summary.companies.contactsDone}</p><p className="text-xs text-gray-500">researched · {summary.companies.verified} verified</p></div>
        <div className="rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Spend</p><p className="mt-1 text-2xl font-semibold">${Number(project.spent_usd).toFixed(2)}</p><div className="mt-1 h-1.5 rounded bg-gray-100"><div className="h-1.5 rounded bg-gray-900" style={{ width: `${spentPct}%` }} /></div><p className="mt-1 text-xs text-gray-500">hard stop ${Number(project.budget_usd).toFixed(2)}</p></div>
        <div className="rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">Status</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-medium text-gray-900">{looping ? <><Loader2 size={14} className="animate-spin" /> Working — keep this page open</> : project.status === 'complete' ? <><CheckCircle2 size={14} className="text-emerald-600" /> Finished</> : project.status === 'running' ? 'Running elsewhere' : st.label}</p>
          <p className="mt-1 text-xs text-gray-500">Round {project.round || 0}{project.status === 'running' ? ' · progress is saved if you leave' : ''}</p></div>
      </div>

      <div className="mb-5 rounded-xl border border-[#e5e3df] bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {PHASES.map((ph, i) => <span key={ph.key} className={`rounded-full px-3 py-1 text-xs ${i < phaseIdx || project.status === 'complete' ? 'bg-gray-900 text-white' : i === phaseIdx ? 'border border-gray-900 font-medium text-gray-900' : 'bg-[#f7f6f3] text-gray-400'}`}>{ph.label}</span>)}
        </div>
        <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-3 lg:grid-cols-6">
          {['context', 'collect', 'select', 'profile', 'contacts', 'verify'].filter((k) => t[k]).map((k) => (
            <div key={k}><div className="flex justify-between"><span>{KIND_LABEL[k]}</span><span>{t[k].done}/{t[k].total}{t[k].failed ? ` · ${t[k].failed} failed` : ''}</span></div><div className="mt-1 h-1 rounded bg-gray-100"><div className="h-1 rounded bg-gray-700" style={{ width: `${pct(k)}%` }} /></div></div>
          ))}
        </div>
        {summary.recent.length > 0 && (
          <details className="mt-3 text-xs text-gray-500">
            <summary className="cursor-pointer select-none">Recent activity</summary>
            <ul className="mt-2 space-y-1">{summary.recent.map((r) => <li key={r.id} className="flex flex-wrap gap-x-3">{r.status === 'failed' ? <AlertTriangle size={12} className="text-red-500" /> : r.status === 'done' ? <CheckCircle2 size={12} className="text-emerald-600" /> : <Loader2 size={12} />}<span>{KIND_LABEL[r.kind]}{r.size ? ` (${r.size})` : ''} · round {r.round}</span><span>{r.searches} searches · ${r.cost.toFixed(3)}</span>{r.error && <span className="text-amber-700">{r.error}</span>}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="rounded-xl border border-[#e5e3df] bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e3df] p-3">
          {([['pass', 'Meeting the criteria'], ['outside', 'Outside the criteria'], ['pending', 'In progress / failed'], ['all', 'All']] as const).map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-lg px-3 py-1.5 text-xs ${filter === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-[#f7f6f3]'}`}>{l}</button>)}
          <select value={sector} onChange={(e) => setSector(e.target.value)} className="rounded-lg border border-[#e5e3df] px-2 py-1.5 text-xs"><option value="all">All sectors</option>{sectors.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company or leader…" className="ml-auto w-56 rounded-lg border border-[#e5e3df] px-2.5 py-1.5 text-xs" />
        </div>
        {!companies ? <p className="p-6 text-sm text-gray-500">Loading companies…</p> : rows.length === 0 ? <p className="p-6 text-sm text-gray-500">No companies here yet{project.status === 'running' ? ' — they appear as profiles finish.' : '.'}</p> : (
          <div className="divide-y divide-[#efede9]">
            {rows.map((c) => {
              const p = c.profile
              const pr = c.outreach?.primary
              const isOpen = open === c.id
              return (
                <div key={c.id}>
                  <button onClick={() => setOpen(isOpen ? null : c.id)} className="grid w-full grid-cols-[18px_1.4fr_1fr_1fr_1.4fr_110px] items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-[#faf9f7]">
                    {isOpen ? <ChevronDown size={15} className="mt-0.5" /> : <ChevronRight size={15} className="mt-0.5" />}
                    <span><span className="font-medium text-gray-900">{p?.name || c.name}</span>{c.origin === 'client' && <span className="ml-2 rounded bg-[#f7f6f3] px-1.5 py-0.5 text-[10px] text-gray-500">client list</span>}<br /><span className="text-xs text-gray-500">{c.sector || 'Other'}{p?.headquarters ? ` · ${p.headquarters}` : ''}</span></span>
                    <span className="text-xs text-gray-700">{p?.leader?.name || '—'}<br /><span className="text-gray-500">{p?.leader?.title}</span></span>
                    <span className="text-xs text-gray-700">{c.verdict ? <><span className={c.verdict.pass ? 'text-emerald-700' : 'text-red-700'}>{c.verdict.label}</span><br /><span className="text-gray-500">{c.verdict.revenue_usd ? `≈ USD ${Math.round(c.verdict.revenue_usd / 1e6)}M` : 'revenue unverified'}</span></> : c.status === 'failed' ? <span className="text-red-600">Profile failed</span> : <span className="text-gray-400">Pending</span>}</span>
                    <span className="text-xs text-gray-700">{pr ? <>{pr.name}{pr.role ? <span className="text-gray-500">, {pr.role}</span> : null}<br /><span className="text-gray-600">{pr.mobile || pr.phone || pr.email}</span></> : c.contacts_done ? '—' : <span className="text-gray-400">{c.status === 'profiled' ? 'not yet' : ''}</span>}</span>
                    <span className="text-xs text-gray-500">{c.verified ? 'verified' : c.contacts_done ? 'contacts found' : c.status}</span>
                  </button>
                  {isOpen && p && (
                    <div className="grid gap-5 bg-[#faf9f7] px-10 py-4 text-sm lg:grid-cols-2">
                      <div className="space-y-2">
                        <p className="text-gray-800">{p.company_narrative}</p>
                        <p><span className="font-medium">Leader:</span> {p.leader.name}{p.leader.since ? ` (since ${p.leader.since})` : ''} — {p.leader.trajectory}</p>
                        {p.leader.interview_hooks && <p><span className="font-medium">Interview angle:</span> {p.leader.interview_hooks}</p>}
                        <p><span className="font-medium">Ownership:</span> {p.ownership}{p.foreign_parent ? ` — foreign parent: ${p.foreign_parent}` : ''}</p>
                        <p><span className="font-medium">Qualification:</span> {c.verdict?.reason}</p>
                        {p.theme_relevance && <p><span className="font-medium">Relevance:</span> {p.theme_relevance}</p>}
                        {p.recent_developments.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-gray-700">{p.recent_developments.map((d, i) => <li key={i}>{d.date ? <b>{d.date}: </b> : null}{d.text}</li>)}</ul>}
                      </div>
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#14419a]">Who to approach</p>
                        {pr ? <ContactLine e={pr} /> : <p className="text-gray-500">{c.verified ? 'No published contact found.' : 'Contacts appear after the contact search and verification.'}</p>}
                        {(c.outreach?.people.length || 0) + (c.outreach?.offices.length || 0) > 1 && <div className="space-y-2 border-t border-[#e5e3df] pt-2">{[...(c.outreach?.people || []), ...(c.outreach?.offices || [])].filter((e) => !(e.name === pr?.name && e.kind === pr?.kind)).slice(0, 4).map((e, i) => <ContactLine key={i} e={e} />)}</div>}
                        {c.outreach?.switchboard && <p className="text-xs text-gray-600">Switchboard: {[c.outreach.switchboard.phone, c.outreach.switchboard.email, c.outreach.switchboard.address].filter(Boolean).join(' · ')}</p>}
                        {c.outreach?.approach && <p className="text-xs text-gray-700"><span className="font-medium">Suggested approach:</span> {c.outreach.approach}</p>}
                        {p.website && <a href={/^https?:/.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer" className="text-xs text-gray-500 underline">{p.website}</a>}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
