import { supabaseAdmin } from '@/lib/supabase/admin'
import { assembleContext } from './engine'
import { parseAmount } from './criteria'
import { normName } from './parse'
import type { CiCompany, CiContactEntry, CiContext, CiProject } from './types'

// One model of "what goes in the report", shared by the PDF, the Excel export
// and the workspace, so they can't disagree.
export interface ReportModel {
  project: CiProject
  sections: { sector: string; companies: CiCompany[] }[]   // companies meeting the criteria
  outsideClient: CiCompany[]                                // client-named companies outside the criteria
  excluded: { name: string; reason: string }[]
  context: CiContext
  total: number
  stats: { withPerson: number; withMobile: number; withAny: number; mobiles: number; mobilesOk: number; phones: number; phonesOk: number }
}

const PRIORITY: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
const QUAL: Record<string, number> = { 'Qualified': 0, 'Likely qualified': 1 }

export function entriesOf(c: CiCompany): CiContactEntry[] {
  const o = c.outreach
  if (!o) return []
  return [...o.people, ...o.offices, ...(o.switchboard ? [o.switchboard] : [])]
}
export const confirmed = (v?: string) => v === 'source' || v === 'website'

// `primary` is a stored copy of one of the entries, so compare by content, not by reference.
export const sameContact = (a: CiContactEntry | null | undefined, b: CiContactEntry | null | undefined) =>
  !!a && !!b && a.kind === b.kind && a.name === b.name && (a.phone || '') === (b.phone || '') && (a.mobile || '') === (b.mobile || '') && (a.email || '') === (b.email || '')
export function othersOf(c: CiCompany, n = 4): CiContactEntry[] {
  const o = c.outreach
  if (!o) return []
  return [...o.people, ...o.offices].filter((e) => !sameContact(e, o.primary)).slice(0, n)
}

export async function buildReportModel(projectId: string): Promise<ReportModel | null> {
  const { data: project } = await supabaseAdmin.from('ci_projects').select('*').eq('id', projectId).maybeSingle()
  if (!project) return null
  const p = project as CiProject
  const { data: rows } = await supabaseAdmin.from('ci_companies').select('*').eq('project_id', projectId)
  const all = (rows || []) as CiCompany[]
  blankSharedUnconfirmedNumbers(all)

  const profiled = all.filter((c) => c.status === 'profiled' && c.profile)
  const passing = profiled.filter((c) => c.verdict?.pass)
  const sectorNames = [...p.sectors.map((s) => s.name), 'Other companies']
  const sortFn = (a: CiCompany, b: CiCompany) =>
    (a.origin === b.origin ? 0 : a.origin === 'client' ? -1 : 1) ||
    (QUAL[a.verdict?.label || ''] ?? 2) - (QUAL[b.verdict?.label || ''] ?? 2) ||
    (PRIORITY[a.profile?.priority || ''] ?? 1) - (PRIORITY[b.profile?.priority || ''] ?? 1) ||
    (b.verdict?.revenue_usd || 0) - (a.verdict?.revenue_usd || 0)
  const sections = sectorNames
    .map((s) => ({ sector: s, companies: passing.filter((c) => (sectorNames.includes(c.sector || '') ? c.sector : 'Other companies') === s).sort(sortFn) }))
    .filter((s) => s.companies.length)
  const outsideClient = profiled.filter((c) => c.origin === 'client' && !c.verdict?.pass)

  const { data: selects } = await supabaseAdmin.from('ci_tasks').select('result').eq('project_id', projectId).eq('kind', 'select').eq('status', 'done')
  const inReport = new Set([...passing, ...outsideClient].map((c) => c.norm_name))
  const excluded = [
    ...profiled.filter((c) => c.origin === 'discovered' && !c.verdict?.pass).map((c) => ({ name: c.profile?.name || c.name, reason: c.verdict?.reason || 'Outside the criteria' })),
    ...(selects || []).flatMap((t) => ((t.result as { excluded?: { name: string; reason: string }[] } | null)?.excluded || [])),
  ].filter((x, i, a) => x.name && a.findIndex((y) => y.name.toLowerCase() === x.name.toLowerCase()) === i && !inReport.has(normName(x.name)))

  const stats = { withPerson: 0, withMobile: 0, withAny: 0, mobiles: 0, mobilesOk: 0, phones: 0, phonesOk: 0 }
  for (const c of passing) {
    const es = entriesOf(c)
    if ((c.outreach?.people || []).length) stats.withPerson++
    if (es.some((e) => e.mobile)) stats.withMobile++
    if (es.some((e) => e.phone || e.mobile || e.email) || c.profile?.switchboard?.phone) stats.withAny++
    for (const e of es) {
      if (e.mobile) { stats.mobiles++; if (confirmed(e.checks.mobile)) stats.mobilesOk++ }
      if (e.phone) { stats.phones++; if (confirmed(e.checks.phone)) stats.phonesOk++ }
    }
  }
  const context = p.context || (await assembleContext(projectId))
  return { project: p, sections, outsideClient, excluded, context, total: passing.length, stats }
}

// A number that appears under two different companies and was not confirmed on
// either company's pages is a sign of an invented or mis-assigned contact.
function blankSharedUnconfirmedNumbers(all: CiCompany[]) {
  const n9 = (s: string) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : '' }
  const owners = new Map<string, Set<string>>()
  for (const c of all) for (const e of entriesOf(c)) for (const f of ['phone', 'mobile'] as const) { const n = n9(e[f]); if (n) owners.set(n, (owners.get(n) || new Set()).add(c.id)) }
  for (const c of all) for (const e of [...entriesOf(c), ...(c.outreach?.primary ? [c.outreach.primary] : [])]) for (const f of ['phone', 'mobile'] as const) {
    const n = n9(e[f]); if (n && (owners.get(n)?.size || 0) > 1 && !confirmed(e.checks?.[f])) e[f] = ''
  }
}

export function human(n: number): string {
  const f = (y: number) => y.toLocaleString('en-GB', { maximumFractionDigits: 2 })
  return n >= 1e9 ? `${f(n / 1e9)} billion` : n >= 1e6 ? `${f(n / 1e6)} million` : f(n)
}

export function revenueText(c: CiCompany): string {
  const r = c.profile?.revenue
  if (!r) return 'Revenue unverified'
  const a = parseAmount(r.amount)
  if (!a) return /unverified/i.test(r.amount || '') || !r.amount ? 'Revenue unverified' : r.amount
  const cur = String(r.currency || '')
  const code = ((cur + ' ' + r.amount).match(/\b[A-Z]{3}\b/) || [''])[0]
  const curMult = /billion|bn|mld/i.test(cur) ? 1e9 : /million|mln|mn|\bm\b/i.test(cur) ? 1e6 : null
  const mult = a.mult || curMult || (a.v < 1000 ? 1e6 : 1)
  const usd = c.verdict?.revenue_usd
  return `${code ? code + ' ' : ''}${human(a.v * mult)}${r.year ? ` (${r.year})` : ''}${usd && code !== 'USD' ? ` [~USD ${human(usd)}]` : ''}${r.status === 'Unverified' ? ' — unverified' : ''}`
}

export function phoneText(p: string): string {
  return String(p || '').trim()
}
