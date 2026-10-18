'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Radar, Info } from 'lucide-react'
import { DEPTHS, estimateRun } from '@/lib/country-intel/depth'
import { parseClientList } from '@/lib/country-intel/parse'
import type { CiDepth, CiSector } from '@/lib/country-intel/types'

const PRESETS: Record<string, { label: string; sectors: CiSector[] }> = {
  security: {
    label: 'Security, defence & resilience',
    sectors: [
      { name: 'Defence & Security', scope: 'defence manufacturers and state defence groups, ammunition and explosives, military vehicles, shipbuilding, defence electronics, drones and counter-drone, protective equipment, military maintenance' },
      { name: 'Cybersecurity & Technology', scope: 'cybersecurity, IT services and integration, telecoms operators, secure identity documents, data centres and cloud' },
      { name: 'Energy Security', scope: 'oil, gas and fuels, power generation and grids, nuclear, energy storage, energy infrastructure and contractors' },
      { name: 'Space & Advanced Technology', scope: 'space and satellites, photonics, semiconductors, electronics manufacturing, advanced manufacturing' },
      { name: 'Infrastructure, Transport & Logistics', scope: 'rail, ports, airports, shipping, logistics, postal services, construction of transport and military infrastructure' },
      { name: 'Financial Security & Resilience', scope: 'banks, insurers, development and export-credit institutions, market infrastructure, payments' },
      { name: 'Strategic Industry', scope: 'chemicals, metals and steel, mining and critical raw materials, heavy machinery, rolling stock' },
    ],
  },
  economy: {
    label: 'Broad economy',
    sectors: [
      { name: 'Banking & Finance', scope: 'banks, insurers, asset managers, capital markets, fintech' },
      { name: 'Telecommunications & Technology', scope: 'telecoms, IT services, software, data centres' },
      { name: 'Infrastructure & Construction', scope: 'construction groups, engineering, transport infrastructure, ports and airports' },
      { name: 'Energy & Utilities', scope: 'oil and gas, power, renewables, utilities, mining' },
      { name: 'Manufacturing & Industry', scope: 'industrial groups, chemicals, metals, automotive, consumer goods' },
      { name: 'Real Estate', scope: 'developers, property groups, REITs' },
      { name: 'Tourism & Hospitality', scope: 'hotel groups, airlines, tourism operators' },
      { name: 'Agriculture & Food', scope: 'agribusiness, food processing, beverages, retail' },
    ],
  },
}

const field = 'w-full rounded-lg border border-[#e5e3df] bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none'
const lbl = 'text-[11px] font-semibold uppercase tracking-widest text-gray-500'

export default function NewResearchForm() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [country, setCountry] = useState('')
  const [brief, setBrief] = useState('')
  const [sectors, setSectors] = useState<CiSector[]>(PRESETS.security.sectors)
  const [clientList, setClientList] = useState('')
  const [target, setTarget] = useState(150)
  const [depth, setDepth] = useState<CiDepth>('standard')
  const [minRevenueM, setMinRevenueM] = useState(60)
  const [localHqOnly, setLocalHqOnly] = useState(true)
  const [includeContacts, setIncludeContacts] = useState(true)
  const [includeContext, setIncludeContext] = useState(true)
  const [budget, setBudget] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clients = useMemo(() => parseClientList(clientList, sectors.map((s) => s.name)), [clientList, sectors])
  const est = useMemo(() => estimateRun({ depth, targetCount: target, sectorCount: sectors.filter((s) => s.name.trim()).length, clientCount: clients.length, includeContacts, includeContext }), [depth, target, sectors, clients.length, includeContacts, includeContext])
  const contactsAvailable = DEPTHS[depth].contacts

  const setSector = (i: number, patch: Partial<CiSector>) => setSectors((ss) => ss.map((s, k) => (k === i ? { ...s, ...patch } : s)))

  async function submit(start: boolean) {
    setError(null)
    if (!title.trim() || !country.trim()) { setError('Add a title and the country.'); return }
    if (!sectors.some((s) => s.name.trim())) { setError('Add at least one sector.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/country-intel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, country, brief, sectors: sectors.filter((s) => s.name.trim()), clientList, targetCount: target, depth, minRevenueUsd: minRevenueM * 1e6, localHqOnly, includeContacts: includeContacts && contactsAvailable, includeContext, budgetUsd: budget ? Number(budget) : undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not create the research.')
      if (start) {
        const s = await fetch(`/api/country-intel/${j.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) })
        if (!s.ok) throw new Error((await s.json()).error || 'Created, but could not start.')
      }
      router.push(`/commercial/country-intelligence/${j.id}${start ? '?run=1' : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/commercial/country-intelligence" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-black"><ArrowLeft size={14} /> Country Intelligence</Link>
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700"><Radar size={18} /></div>
        <div>
          <h1 className="text-base font-semibold text-gray-900">New country research</h1>
          <p className="mt-1 text-sm text-gray-500">Every company in the result is checked against the criteria below in code — not on the AI&apos;s say-so — and gets a who-to-approach contact block.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5"><span className={lbl}>Title</span><input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Poland — security report for MSC 2027" /></label>
              <label className="space-y-1.5"><span className={lbl}>Country</span><input className={field} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Poland" /></label>
            </div>
            <label className="block space-y-1.5"><span className={lbl}>Report theme / event / publication angle</span>
              <textarea className={`${field} min-h-[70px]`} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Sectoral report on Poland's security economy, published to coincide with the Munich Security Conference, February 2027. Cross-border angle: Germany, NATO allies, EU SAFE programmes, Ukraine." />
            </label>
          </section>

          <section className="rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className={lbl}>Sectors ({sectors.length})</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(PRESETS).map(([k, p]) => <button key={k} type="button" onClick={() => setSectors(p.sectors)} className="rounded-lg border border-[#e5e3df] px-2.5 py-1 text-xs text-gray-600 hover:border-gray-900 hover:text-black">{p.label}</button>)}
                <button type="button" onClick={() => setSectors([{ name: '', scope: '' }])} className="rounded-lg border border-[#e5e3df] px-2.5 py-1 text-xs text-gray-600 hover:border-gray-900">Clear</button>
              </div>
            </div>
            <div className="space-y-2">
              {sectors.map((s, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[220px_1fr_32px]">
                  <input className={field} value={s.name} onChange={(e) => setSector(i, { name: e.target.value })} placeholder="Sector name" />
                  <input className={field} value={s.scope} onChange={(e) => setSector(i, { scope: e.target.value })} placeholder="What it covers (helps the search find the right companies)" />
                  <button type="button" onClick={() => setSectors((ss) => ss.filter((_, k) => k !== i))} className="flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-red-600" aria-label="Remove sector"><Trash2 size={15} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setSectors((ss) => [...ss, { name: '', scope: '' }])} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-black"><Plus size={14} /> Add sector</button>
            </div>
          </section>

          <section className="rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm space-y-2">
            <div className="flex items-center justify-between"><span className={lbl}>Client&apos;s company list (optional)</span><span className="text-xs text-gray-500">{clients.length} companies recognised</span></div>
            <textarea className={`${field} min-h-[150px] font-mono text-xs`} value={clientList} onChange={(e) => setClientList(e.target.value)} placeholder={'Paste the list as the client sent it — sector names on their own line, then one company per line:\n\nDefence & Security\nPolska Grupa Zbrojeniowa (PGZ)\nWB Group\nEnergy Security\nORLEN'} />
            <p className="text-xs text-gray-500">Every company on this list is researched and kept. Those that don&apos;t meet the criteria appear in their own section, not in the count.</p>
          </section>

          <section className="rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm space-y-4">
            <div>
              <div className="flex items-center justify-between"><span className={lbl}>Target companies meeting the criteria</span><span className="text-sm font-semibold text-gray-900">{target}</span></div>
              <input type="range" min={10} max={300} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="mt-2 w-full accent-black" />
              <p className="text-xs text-gray-500">Extra discovery rounds run automatically until this many companies pass — or the depth&apos;s round limit is reached, if the country doesn&apos;t have that many.</p>
            </div>
            <div>
              <span className={lbl}>Research depth</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(Object.keys(DEPTHS) as CiDepth[]).map((k) => (
                  <button key={k} type="button" onClick={() => setDepth(k)} className={`rounded-xl border p-3 text-left transition-colors ${depth === k ? 'border-gray-900 bg-[#f7f6f3]' : 'border-[#e5e3df] hover:border-gray-400'}`}>
                    <div className="flex items-center justify-between"><span className="text-sm font-semibold">{DEPTHS[k].label}</span><span className="text-xs text-gray-500">~${(DEPTHS[k].costPerProfile * DEPTHS[k].overgenerate + DEPTHS[k].costPerContacts).toFixed(3)}/co.</span></div>
                    <p className="mt-1 text-xs leading-relaxed text-gray-500">{DEPTHS[k].description}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5"><span className={lbl}>Minimum annual revenue (USD million)</span><input type="number" min={0} className={field} value={minRevenueM} onChange={(e) => setMinRevenueM(Math.max(0, Number(e.target.value)))} /></label>
              <div className="space-y-2 pt-5 text-sm text-gray-700">
                <label className="flex items-center gap-2"><input type="checkbox" checked={localHqOnly} onChange={(e) => setLocalHqOnly(e.target.checked)} /> Only companies headquartered and owned in the country</label>
                <label className={`flex items-center gap-2 ${contactsAvailable ? '' : 'text-gray-400'}`}><input type="checkbox" disabled={!contactsAvailable} checked={includeContacts && contactsAvailable} onChange={(e) => setIncludeContacts(e.target.checked)} /> Dedicated contact search (who to approach){!contactsAvailable && ' — Standard or Deep'}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={includeContext} onChange={(e) => setIncludeContext(e.target.checked)} /> Country context (officials, events, key figures)</label>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-[#e5e3df] bg-white p-5 shadow-sm">
            <p className={lbl}>Estimate</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">${est.expectedUsd.toFixed(2)}</p>
            <p className="text-xs text-gray-500">expected Gemini cost · about {est.minutes} minutes</p>
            <ul className="mt-3 space-y-1 text-xs text-gray-600">{est.breakdown.map((b) => <li key={b.label} className="flex justify-between gap-2"><span>{b.label}</span><span>${b.usd.toFixed(2)}</span></li>)}</ul>
            <label className="mt-4 block space-y-1.5"><span className={lbl}>Hard stop (USD)</span><input className={field} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))} placeholder={est.budgetUsd.toFixed(2)} /></label>
            <p className="mt-1.5 text-xs text-gray-500">The run pauses before any call that would go past this. You can raise it and resume.</p>
            <div className="mt-3 flex gap-2 rounded-lg bg-[#f7f6f3] p-2.5 text-xs text-gray-600"><Info size={14} className="mt-0.5 flex-shrink-0" /><span>Research runs while the project page is open. Progress is saved — close it and resume any time.</span></div>
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <button type="button" disabled={busy} onClick={() => submit(true)} className="w-full rounded-xl bg-black py-3 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50">{busy ? 'Starting…' : 'Start research'}</button>
          <button type="button" disabled={busy} onClick={() => submit(false)} className="w-full rounded-xl border border-[#e5e3df] bg-white py-2.5 text-sm text-gray-700 hover:border-gray-900 disabled:opacity-50">Save without starting</button>
        </aside>
      </div>
    </div>
  )
}
