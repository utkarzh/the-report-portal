import type { CiCompany, CiContactEntry, CiOutreach, CiCheck } from './types'

// Free verification (no AI calls), ported from the manual Poland run:
//  • drops dead source links (≈30–50% of URLs a model writes out are dead);
//  • resolves Google's grounding redirects to the real result pages;
//  • merges the dedicated contact research with the contacts found while
//    profiling, then checks every phone / mobile / email / name against the
//    cited page AND the company's own pages — site root, press / media / IR
//    paths and subdomains, the parent of every cited contact page, and the
//    company-domain search results. A narrow check wrongly "failed" real
//    numbers (Enea's press line lived on media.enea.pl), so it is wide on
//    purpose. Unconfirmed details are kept and marked, never silently dropped.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const SITE_PATHS = ['', '/kontakt', '/contact', '/en/contact', '/contact-us', '/en/contact-us', '/media', '/en/media', '/press', '/newsroom', '/biuro-prasowe', '/dla-mediow', '/relacje-inwestorskie', '/investor-relations', '/en/investor-relations', '/about/contact']

interface Page { ok: boolean; status: number | string; text: string; readable: boolean; location?: string | null }

// `hardStop` (epoch ms) bounds every fetch so a batch of website checks can't
// outlive its serverless request: past it, fetches return at once and
// `expired()` turns true, so the caller can re-queue instead of saving a
// half-checked company.
export function makeFetcher(timeoutMs = 9000, hardStop = Infinity) {
  const cache = new Map<string, Promise<Page>>()
  let expired = false
  const get = function get(url: string, manual = false): Promise<Page> {
    if (!/^https?:\/\//.test(url || '')) return Promise.resolve({ ok: false, status: 'invalid', text: '', readable: false })
    const key = (manual ? 'M:' : '') + url
    const hit = cache.get(key)
    if (hit) return hit
    const left = hardStop - Date.now()
    if (left < 1000) { expired = true; return Promise.resolve({ ok: false, status: 'skipped', text: '', readable: false }) }
    const cut = left < timeoutMs
    const p = (async (): Promise<Page> => {
      const ctrl = new AbortController()
      const t = setTimeout(() => { if (cut) expired = true; ctrl.abort() }, cut ? left : timeoutMs)
      try {
        const r = await fetch(url, { redirect: manual ? 'manual' : 'follow', signal: ctrl.signal, cache: 'no-store', headers: { 'User-Agent': UA, 'Accept-Language': 'en,*;q=0.7' } })
        if (manual) return { ok: true, status: r.status, text: '', readable: false, location: r.headers.get('location') }
        const ct = r.headers.get('content-type') || ''
        let text = ''
        if (r.ok && /html|text|json/.test(ct)) text = (await r.text()).slice(0, 1_500_000)
        else await r.body?.cancel().catch(() => {})
        // 401/403/405/429 = the page exists but blocks robots: keep the link, can't read it.
        return { ok: r.ok || [401, 403, 405, 429].includes(r.status), status: r.status, text, readable: r.ok && !!text }
      } catch {
        return { ok: false, status: 'unreachable', text: '', readable: false }
      } finally { clearTimeout(t) }
    })()
    cache.set(key, p)
    return p
  }
  return Object.assign(get, { expired: () => expired })
}

const plain = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#64;|&commat;/g, '@').replace(/\s+/g, ' ')
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
const collapse = (s: string) => s.replace(/(?<=\d)[\s\-().\/ ]+(?=\d)/g, '')
const n9 = (p: string) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : '' }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function onPage(html: string, field: 'phone' | 'email' | 'name', value: string): boolean {
  const t = plain(html)
  if (field === 'phone') { const k = n9(value); return !!k && (collapse(t).includes(k) || t.replace(/\D/g, '').includes(k)) }
  if (field === 'email') {
    const e = value.toLowerCase().trim(); const lt = t.toLowerCase(); const [u, d] = e.split('@')
    if (lt.includes(e) || html.toLowerCase().includes(e)) return true
    return !!(u && d) && new RegExp(`${esc(u)}\\s*[\\[(]?\\s*(at|małpa)\\s*[\\])]?\\s*${d.replace(/\./g, '\\s*[.\\[(]?\\s*(dot|kropka)?\\s*[\\])]?\\s*')}`).test(lt)
  }
  const parts = fold(value).split(/\s+/).filter((x) => x.length > 2)
  const ft = fold(t)
  return parts.length > 0 && parts.every((p) => ft.includes(p))
}

const regDomain = (h: string) => { const p = h.replace(/^www\./, '').split('.'); return p.slice(/^(com|co|org|net|gov|edu|info|biz|ac)$/.test(p[p.length - 2]) ? -3 : -2).join('.') }
const deptLike = /biuro|dzia[lł]|office|department|sekretariat|secretariat|press|media|relacj|investor|centrala|switchboard|recepcja|kancelaria|zesp[oó][lł]|team|general|desk|newsroom/i
const isMobileGuess = (p: string, country: string) => /pol(and|ska)/i.test(country) && /^(45|50|51|53|57|60|66|69|72|73|78|79|88)/.test(n9(p))
const junkPhone = (p: string) => { const d = n9(p); return !d || /(\d)\1{5,}/.test(d) || ['123456789', '987654321'].includes(d) }
const junkMail = (e: string) => !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e || '') || /daneosobowe|^iod@|^dpo@|rodo@|gdpr|privacy@|inspektor|abuse@|no-?reply|example\./i.test(e || '')
const personKey = (n: string) => { const t = fold(n).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((x) => x.length > 1); return t.length ? `${t[0]} ${t[t.length - 1]}` : '' }

function roleRank(e: CiContactEntry): number {
  const r = fold(`${e.role} ${e.name}`)
  if (/rzeczni|prasow|press|spokes|komunikac|communicat|media|public relations|\bpr\b|portavoce|sprecher|porte-parole/.test(r)) return 0
  if (/marketing|sponsor|promoc|brand|wizerun/.test(r)) return 1
  if (/biur[oa] zarzadu|board office|chief of staff|szef gabinetu|assistant|asystent|sekretariat|secretariat|kancelaria|ceo office/.test(r)) return 2
  if (/inwestor|investor|\bir\b/.test(r)) return 3
  return 4
}

export async function verifyCompany(c: CiCompany, country: string, get = makeFetcher()): Promise<{
  outreach: CiOutreach
  sources: { title: string; url: string; date?: string }[]
  developments: { date: string; text: string; source_url: string }[]
  revenueSource: string
  grounded: { title: string; url: string }[]
}> {
  const p = c.profile!
  // ── merge contacts: dedicated research first, then what profiling found
  const people = new Map<string, CiContactEntry>()
  const offices = new Map<string, CiContactEntry>()
  const addPerson = (x: { name: string; role?: string; phone?: string; mobile?: string; email?: string; source_url?: string; ask_for?: string }) => {
    const k = personKey(x.name); if (!k) return
    let phone = x.phone || '', mobile = x.mobile || ''
    if (!mobile && isMobileGuess(phone, country)) { mobile = phone; phone = '' }
    const cur = people.get(k)
    if (!cur) people.set(k, { kind: 'person', name: x.name, role: x.role || '', phone, mobile, email: x.email || '', source_url: x.source_url || '', ask_for: x.ask_for || '', checks: {} })
    else {
      const add = { role: x.role || '', phone, mobile, email: x.email || '', source_url: x.source_url || '', ask_for: x.ask_for || '' }
      for (const [f, v] of Object.entries(add) as [keyof typeof add, string][]) if (!cur[f] && v) (cur as unknown as Record<string, string>)[f] = v
    }
  }
  const addOffice = (name: string, phone: string, email: string, url: string) => {
    if (!phone && !email) return
    const k = `${n9(phone)}|${(email || '').toLowerCase()}`
    if (!offices.has(k)) offices.set(k, { kind: 'office', name: name || 'Office', role: '', phone: isMobileGuess(phone, country) ? '' : phone, mobile: isMobileGuess(phone, country) ? phone : '', email, source_url: url, checks: {} })
  }
  const R = c.contacts_raw
  for (const x of R?.people || []) addPerson(x)
  for (const o of R?.offices || []) addOffice(o.name, o.phone, o.email, o.source_url)
  for (const x of p.contacts || []) {
    if (!x.name || deptLike.test(x.name)) addOffice(x.name || x.role, x.phone, x.email, x.source_url)
    else addPerson(x)
  }
  const swR = R?.switchboard, swP = p.switchboard
  const sw: CiContactEntry = { kind: 'switchboard', name: 'Switchboard / head office', role: '', phone: swR?.phone || swP?.phone || '', mobile: '', email: swR?.email || swP?.email || '', address: swR?.address || swP?.address || '', source_url: swR?.source_url || swP?.source_url || '', checks: {} }
  const entries = [...people.values(), ...offices.values(), sw]

  // ── resolve the Google result pages behind the profile
  const grounded: { title: string; url: string }[] = []
  await Promise.all((c.grounding || []).slice(0, 12).map(async (g) => {
    const r = await get(g.uri, true)
    if (r.location) grounded.push({ title: g.title, url: r.location })
  }))

  // ── pages where the company publishes contacts
  const cand = new Set<string>()
  let rd: string | null = null
  const site = /^https?:\/\//.test(p.website || '') ? p.website : p.website ? `https://${p.website}` : ''
  try {
    if (site) { const o = new URL(site).origin; rd = regDomain(new URL(o).hostname); for (const s of SITE_PATHS) cand.add(o + s); for (const sub of ['media', 'ir', 'press', 'newsroom']) cand.add(`https://${sub}.${rd}`) }
  } catch { /* bad website URL */ }
  const hosts = new Set<string>()
  for (const x of entries) {
    try { const U = new URL(x.source_url); hosts.add(regDomain(U.hostname)); cand.add(`${U.origin}/`); const seg = U.pathname.split('/').filter(Boolean); if (seg.length > 1) cand.add(`${U.origin}/${seg.slice(0, -1).join('/')}`) } catch { /* no url */ }
  }
  for (const g of grounded.slice(0, 8)) { try { const d = regDomain(new URL(g.url).hostname); if (d === rd || hosts.has(d)) cand.add(g.url) } catch { /* skip */ } }
  const sitePages = (await Promise.all([...cand].map((u) => get(u)))).filter((r) => r.readable)

  // ── sources and developments: drop dead links
  const sources = (await Promise.all((p.sources || []).map(async (s) => ((await get(s.url)).ok ? s : null)))).filter(Boolean) as { title: string; url: string; date?: string }[]
  const developments = await Promise.all((p.recent_developments || []).map(async (d) => (d.source_url && !(await get(d.source_url)).ok ? { ...d, source_url: '' } : d)))
  const revenueSource = p.revenue?.source_url && (await get(p.revenue.source_url)).ok ? p.revenue.source_url : ''

  // ── check every contact detail
  for (const e of entries) {
    const src = e.source_url ? await get(e.source_url) : { ok: false, readable: false, text: '', status: 0 }
    const pages = [src.readable ? src : null, ...sitePages].filter(Boolean) as Page[]
    const checks: Partial<Record<'phone' | 'mobile' | 'email' | 'name', CiCheck>> = {}
    for (const f of ['phone', 'mobile', 'email', 'name'] as const) {
      if (!e[f] || (f === 'name' && e.kind !== 'person')) continue
      if ((f === 'phone' || f === 'mobile') && junkPhone(e[f])) { e[f] = ''; continue }
      if (f === 'email' && junkMail(e[f])) { e[f] = ''; continue }
      const key = f === 'mobile' ? 'phone' : f
      let hit: CiCheck | null = null
      for (const [i, pg] of pages.entries()) { if (onPage(pg.text, key, e[f])) { hit = i === 0 && src.readable ? 'source' : 'website'; break } }
      checks[f] = hit || 'unconfirmed'
    }
    if (!src.ok) e.source_url = ''
    e.checks = checks
  }
  const confirmed = (e: CiContactEntry) => (['phone', 'mobile', 'email'] as const).some((f) => e.checks[f] === 'source' || e.checks[f] === 'website')
  const score = (e: CiContactEntry) => roleRank(e) * 10 - (e.mobile ? 3 : 0) - (e.phone ? 2 : 0) - (e.email ? 1 : 0) - (confirmed(e) ? 2 : 0)
  const reachable = (e: CiContactEntry) => !!(e.phone || e.mobile || e.email)
  const ppl = [...people.values()].filter((e) => e.name).sort((x, y) => score(x) - score(y))
  const offs = [...offices.values()].filter(reachable).sort((x, y) => score(x) - score(y))
  return {
    outreach: {
      primary: ppl.find(reachable) || offs[0] || (reachable(sw) ? sw : null),
      people: ppl,
      offices: offs,
      switchboard: reachable(sw) || sw.address ? sw : null,
      approach: R?.approach || '',
    },
    sources,
    developments,
    revenueSource,
    grounded,
  }
}
