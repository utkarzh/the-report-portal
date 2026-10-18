import { supabaseAdmin } from '@/lib/supabase/admin'
import { logUsageEvent } from '@/lib/claude/usage'
import type { UsageWorkflow } from '@/types'
import { DEPTHS, RESEARCH_MODEL } from './depth'
import { callGemini, extractJson, worstCaseCost, GeminiError, type GeminiResult } from './gemini'
import { DEFAULT_SYSTEM_PROMPT, SEARCH_FIRST, systemPrompt, contextQuestions, collectQuestion, selectPrompt, profilePrompt, contactsPrompt, type CollectVariant } from './prompts'
import { normName, parseProfiles, parseContacts, parsePipeRows, chunksForSpan } from './parse'
import { assess } from './criteria'
import { verifyCompany, makeFetcher } from './verify'
import type { CiProject, CiCompany, CiTask, CiTaskKind, CiContext, CiPhase } from './types'

// ────────────────────────────────────────────────────────────────────────────
// The Country Intelligence engine: a resumable work queue (ci_tasks) driven by
// short serverless requests. Each /step request plans the next phase when the
// current one has drained, claims up to CONCURRENCY tasks atomically
// (ci_claim_tasks), runs them, and returns — so a run of hundreds of Gemini
// calls never depends on a single request surviving.
//
// Phases: context_discovery → selecting → profiling → (more discovery rounds
// until the target count of companies MEETING THE CRITERIA is reached, or the
// depth's round limit) → contacts → verifying → done.
// Phase changes are compare-and-set on (phase, round), so two workers (two
// open tabs) can never both create the next phase's tasks.
// ────────────────────────────────────────────────────────────────────────────

const STEP_WINDOW_MS = 240_000     // a /step request works for up to ~4 minutes (maxDuration 300s)
const CLAIM_CUTOFF_MS = 150_000    // no new task is claimed after this, so in-flight calls finish in time
const VERIFY_HARD_STOP_MS = 35_000 // website checks stop this long after the step deadline (≈275s, inside the 300s cap)
const CONCURRENCY = 3
const MAX_ATTEMPTS = 5
const CONTACT_BATCH = 3
const VERIFY_BATCH = 2

class RetryLater extends Error {}
class Defer extends Error {}
class BudgetReached extends Error {}

type Db = typeof supabaseAdmin

const WORKFLOW: Record<CiTaskKind, UsageWorkflow> = {
  context: 'country_intel_context',
  collect: 'country_intel_discovery',
  select: 'country_intel_discovery',
  profile: 'country_intel_profiles',
  contacts: 'country_intel_contacts',
  verify: 'country_intel_contacts',
}

export async function loadSystemPrompt(db: Db = supabaseAdmin): Promise<string> {
  const { data } = await db.from('ci_system_prompt').select('prompt_text').eq('id', 1).maybeSingle()
  return data?.prompt_text?.trim() || DEFAULT_SYSTEM_PROMPT
}

async function getProject(id: string): Promise<CiProject | null> {
  const { data } = await supabaseAdmin.from('ci_projects').select('*').eq('id', id).maybeSingle()
  return (data as CiProject) || null
}

async function casPhase(p: CiProject, from: { phase: CiPhase; round: number }, to: Partial<CiProject>): Promise<boolean> {
  const { data } = await supabaseAdmin.from('ci_projects').update({ ...to, updated_at: new Date().toISOString() })
    .eq('id', p.id).eq('phase', from.phase).eq('round', from.round).eq('status', 'running').select('id')
  return !!data?.length
}

async function addTasks(projectId: string, rows: { kind: CiTaskKind; round: number; payload: Record<string, unknown> }[]) {
  if (!rows.length) return
  const { error } = await supabaseAdmin.from('ci_tasks').insert(rows.map((r) => ({ project_id: projectId, ...r })))
  if (error) throw new Error(`could not queue tasks: ${error.message}`)
}

const chunk = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// ── start ───────────────────────────────────────────────────────────────────
export async function startProject(p: CiProject): Promise<void> {
  const d = DEPTHS[p.depth]
  const { data: clients } = await supabaseAdmin.from('ci_companies').select('id').eq('project_id', p.id).eq('origin', 'client')
  const rows: { kind: CiTaskKind; round: number; payload: Record<string, unknown> }[] = []
  if (p.include_context) {
    const n = Math.max(d.contextQuestions, p.depth === 'quick' ? 3 : 0)
    for (const q of contextQuestions(p, n)) rows.push({ kind: 'context', round: 1, payload: { key: q.key, cols: q.cols, q: q.q } })
  }
  const variants: CollectVariant[] = (['largest', 'news', 'rankings'] as CollectVariant[]).slice(0, d.questionsPerSector)
  for (const s of p.sectors) for (const v of variants) rows.push({ kind: 'collect', round: 1, payload: { sector: s.name, variant: v } })
  for (const b of chunk((clients || []).map((c) => c.id as string), d.profileBatch)) rows.push({ kind: 'profile', round: 1, payload: { company_ids: b } })
  await addTasks(p.id, rows)
  await supabaseAdmin.from('ci_projects').update({ status: 'running', phase: 'context_discovery', round: 1, started_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq('id', p.id)
}

// ── planner ─────────────────────────────────────────────────────────────────
async function plan(p: CiProject): Promise<CiProject | null> {
  const { data: tasks } = await supabaseAdmin.from('ci_tasks').select('kind, status, round').eq('project_id', p.id)
  const open = (kinds: CiTaskKind[], round?: number) => (tasks || []).some((t) => kinds.includes(t.kind) && (t.status === 'pending' || t.status === 'running') && (round == null || t.round === round))
  const d = DEPTHS[p.depth]
  const at = { phase: p.phase, round: p.round }

  if (p.phase === 'context_discovery' && !open(['collect'], p.round)) {
    if (await casPhase(p, at, { phase: 'selecting' })) {
      const passing = await countPassing(p.id)
      const { count: total } = await supabaseAdmin.from('ci_companies').select('id', { count: 'exact', head: true }).eq('project_id', p.id)
      const need = Math.max(0, p.target_count - passing - (p.round === 1 ? (total || 0) : 0))
      const cap = Math.ceil(p.target_count * 2.2) - (total || 0)
      const want = Math.max(0, Math.min(120, cap, Math.ceil(need * d.overgenerate)))
      if (want > 0) await addTasks(p.id, [{ kind: 'select', round: p.round, payload: { want } }])
      else await supabaseAdmin.from('ci_projects').update({ phase: 'profiling' }).eq('id', p.id).eq('phase', 'selecting')
    }
    return getProject(p.id)
  }
  if (p.phase === 'selecting' && !open(['select', 'collect'])) {
    await casPhase(p, at, { phase: 'profiling' })
    return getProject(p.id)
  }
  if (p.phase === 'profiling' && !open(['collect', 'select', 'profile'])) {
    const passing = await countPassing(p.id)
    const { count: newThisRound } = await supabaseAdmin.from('ci_companies').select('id', { count: 'exact', head: true }).eq('project_id', p.id).eq('round', p.round).eq('origin', 'discovered').eq('status', 'profiled')
    const anotherRound = passing < p.target_count && p.round < d.maxRounds && (p.round === 1 || (newThisRound || 0) >= 3)
    if (anotherRound) {
      if (await casPhase(p, at, { phase: 'context_discovery', round: p.round + 1 })) {
        const { data: have } = await supabaseAdmin.from('ci_companies').select('name').eq('project_id', p.id)
        const exclude = (have || []).map((c) => String(c.name)).slice(0, 400)
        await addTasks(p.id, p.sectors.map((s) => ({ kind: 'collect' as const, round: p.round + 1, payload: { sector: s.name, variant: 'large_more', exclude } })))
      }
      return getProject(p.id)
    }
    if (await casPhase(p, at, { phase: p.include_contacts && d.contacts ? 'contacts' : 'verifying' })) {
      const ids = await reportCompanyIds(p.id)
      if (p.include_contacts && d.contacts) await addTasks(p.id, chunk(ids, CONTACT_BATCH).map((b) => ({ kind: 'contacts' as const, round: p.round, payload: { company_ids: b } })))
      else await addTasks(p.id, chunk(ids, VERIFY_BATCH).map((b) => ({ kind: 'verify' as const, round: p.round, payload: { company_ids: b } })))
    }
    return getProject(p.id)
  }
  if (p.phase === 'contacts' && !open(['contacts'])) {
    if (await casPhase(p, at, { phase: 'verifying' })) {
      const ids = await reportCompanyIds(p.id)
      await addTasks(p.id, chunk(ids, VERIFY_BATCH).map((b) => ({ kind: 'verify' as const, round: p.round, payload: { company_ids: b } })))
    }
    return getProject(p.id)
  }
  if (p.phase === 'verifying' && !open(['verify', 'contacts', 'context'])) {
    const context = await assembleContext(p.id)
    await casPhase(p, at, { phase: 'done', status: 'complete', completed_at: new Date().toISOString(), context })
    return getProject(p.id)
  }
  return p
}

async function countPassing(projectId: string): Promise<number> {
  const { data } = await supabaseAdmin.from('ci_companies').select('verdict').eq('project_id', projectId).eq('status', 'profiled')
  return (data || []).filter((c) => (c.verdict as { pass?: boolean } | null)?.pass).length
}

// Companies that appear in the report: everything that meets the criteria, plus
// client-named companies outside them (they get their own section).
async function reportCompanyIds(projectId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('ci_companies').select('id, origin, verdict').eq('project_id', projectId).eq('status', 'profiled')
  return (data || []).filter((c) => c.origin === 'client' || (c.verdict as { pass?: boolean } | null)?.pass).map((c) => c.id as string)
}

export async function assembleContext(projectId: string): Promise<CiContext> {
  const { data } = await supabaseAdmin.from('ci_tasks').select('payload, result').eq('project_id', projectId).eq('kind', 'context').eq('status', 'done')
  const ctx: CiContext = { sources: {} }
  for (const t of data || []) {
    const key = (t.payload as { key: string }).key as keyof Omit<CiContext, 'sources'>
    const r = t.result as { rows?: Record<string, string>[]; chunks?: { title: string; uri: string }[] } | null
    if (!r?.rows) continue
    ctx[key] = r.rows
    ctx.sources![key] = r.chunks || []
  }
  return ctx
}

// ── one Gemini call, with budget, deadline, cheap retries of skipped searches, and booking ──
async function ground(p: CiProject, task: CiTask, deadline: number, opts: { system: string; user: string; maxOutputTokens: number; model?: string; grounded?: boolean; tries?: number; minMs?: number }): Promise<GeminiResult> {
  const model = opts.model || RESEARCH_MODEL
  const grounded = opts.grounded ?? true
  let last: GeminiResult | null = null
  for (let attempt = 1; attempt <= (opts.tries || 4); attempt++) {
    const remaining = deadline - Date.now() - 12_000
    // Deferring is free; a call cut off by the request's time limit may still be billed.
    if (remaining < (opts.minMs || 60_000)) throw new Defer('not enough time left in this request')
    const fresh = await getProject(p.id)
    if (!fresh || fresh.status !== 'running') throw new Defer('project is no longer running')
    if (Number(fresh.spent_usd) + worstCaseCost(model, opts.maxOutputTokens) > Number(fresh.budget_usd)) throw new BudgetReached('budget reached')
    let r: GeminiResult
    try {
      r = await callGemini({ model, system: opts.system, user: grounded ? SEARCH_FIRST + opts.user : opts.user, maxOutputTokens: opts.maxOutputTokens, grounded, earlyAbort: grounded, timeoutMs: Math.min(remaining, 230_000) })
    } catch (e) {
      if (e instanceof GeminiError && e.billedUsd > 0) await book(p, task, model, null, e.billedUsd, 0, String(e.message))
      throw e
    }
    await book(p, task, model, r, r.costUsd, r.queries.length, r.aborted ? 'reply skipped search — cut off early' : null)
    last = r
    if (!grounded || r.queries.length) return r
    // aborted early (cheap) or a full reply without search: try again
  }
  throw new RetryLater(`reply did not search (last attempt ${last?.aborted ? 'cut off early' : 'full'})`)
}

async function book(p: CiProject, task: CiTask, model: string, r: GeminiResult | null, cost: number, searches: number, note: string | null) {
  if (cost <= 0) return
  await supabaseAdmin.rpc('ci_add_spend', { p_project: p.id, p_cost: cost })
  task.cost_usd = Number(task.cost_usd || 0) + cost
  task.searches = (task.searches || 0) + searches
  const u = r?.usage || {}
  const tin = (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0)
  const tout = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)
  await logUsageEvent({
    userId: p.user_id, workflow: WORKFLOW[task.kind], sourceId: p.id, model,
    tokensInput: tin, tokensOutput: tout, tokensTotal: tin + tout, webSearches: searches, costUsd: cost,
    status: note && !r?.aborted ? 'error' : 'success', error: note,
  })
}

// ── executors ───────────────────────────────────────────────────────────────
async function execContext(p: CiProject, t: CiTask, sys: string, deadline: number) {
  const { cols, q } = t.payload as { key: string; cols: string[]; q: string }
  const r = await ground(p, t, deadline, { system: sys, user: `${q}\nPlain lines only, separated by " | ". No JSON, no markdown table, no header row.`, maxOutputTokens: 5000 })
  return { rows: parsePipeRows(r.text, cols), chunks: r.chunks.slice(0, 20), queries: r.queries.length }
}

async function execCollect(p: CiProject, t: CiTask, sys: string, deadline: number) {
  const { sector, variant, exclude } = t.payload as { sector: string; variant: CollectVariant; exclude?: string[] }
  const s = p.sectors.find((x) => x.name === sector) || { name: sector, scope: '' }
  const r = await ground(p, t, deadline, { system: sys, user: `${collectQuestion(p, s, variant, exclude || [])}\nPlain lines only, no JSON.`, maxOutputTokens: 8000 })
  return { sector, variant, text: r.text, queries: r.queries.length }
}

async function execSelect(p: CiProject, t: CiTask, sys: string, deadline: number) {
  const { want } = t.payload as { want: number }
  const { data: collects } = await supabaseAdmin.from('ci_tasks').select('result').eq('project_id', p.id).eq('kind', 'collect').eq('round', t.round).eq('status', 'done')
  const findings = (collects || []).map((c) => { const r = c.result as { sector: string; text: string }; return `### ${r.sector}\n${r.text}` }).join('\n\n')
  const { data: have } = await supabaseAdmin.from('ci_companies').select('name').eq('project_id', p.id)
  const d = DEPTHS[p.depth]
  const r = await ground(p, t, deadline, { system: sys, user: selectPrompt(p, findings, (have || []).map((c) => String(c.name)), want), maxOutputTokens: 30000, grounded: false, model: d.selectModel, minMs: 120_000 })
  const data = extractJson<{ candidates?: { name: string; website?: string; hq_city?: string; ownership?: string; sector?: string; revenue_usd_million?: number; revenue_year?: string; scale_evidence?: string }[]; considered_but_excluded?: { name: string; reason: string }[] }>(r.text)
  if (!data?.candidates) throw new RetryLater('selection reply was not valid JSON')
  const names = new Set((have || []).map((c) => normName(String(c.name))))
  const sectorNames = p.sectors.map((s) => s.name)
  const rows: Record<string, unknown>[] = []
  for (const c of data.candidates.slice(0, want)) {
    const nn = normName(c.name)
    if (!nn || names.has(nn)) continue
    names.add(nn)
    const sector = sectorNames.find((s) => s.toLowerCase() === String(c.sector || '').toLowerCase()) || sectorNames.find((s) => String(c.sector || '').toLowerCase().includes(s.toLowerCase().split(' ')[0])) || null
    rows.push({
      project_id: p.id, name: c.name, norm_name: nn, origin: 'discovered', sector, round: t.round,
      hint: [c.website, c.hq_city, c.revenue_usd_million ? `revenue ≈ USD ${c.revenue_usd_million}M (${c.revenue_year || ''})` : ''].filter(Boolean).join('; ').slice(0, 220),
      alt_revenue_usd_million: Number(c.revenue_usd_million) > 0 ? Number(c.revenue_usd_million) : null,
    })
  }
  if (rows.length) {
    const { data: inserted, error } = await supabaseAdmin.from('ci_companies').upsert(rows, { onConflict: 'project_id,norm_name', ignoreDuplicates: true }).select('id')
    if (error) throw new Error(`could not save candidates: ${error.message}`)
    await addTasks(p.id, chunk((inserted || []).map((x) => x.id as string), d.profileBatch).map((b) => ({ kind: 'profile' as const, round: t.round, payload: { company_ids: b } })))
  }
  return { selected: rows.length, excluded: (data.considered_but_excluded || []).slice(0, 80) }
}

async function execProfile(p: CiProject, t: CiTask, sys: string, deadline: number) {
  const ids = (t.payload as { company_ids: string[] }).company_ids
  const { data: cs } = await supabaseAdmin.from('ci_companies').select('*').in('id', ids).eq('status', 'pending')
  const companies = (cs || []) as CiCompany[]
  if (!companies.length) return { profiled: 0 }
  const d = DEPTHS[p.depth]
  const r = await ground(p, t, deadline, { system: sys, user: profilePrompt(p, companies, d.profileDetail), maxOutputTokens: d.profileDetail === 'full' ? 12000 : 9000, minMs: 120_000 })
  const parsed = parseProfiles(r.text)
  const done = new Set<string>()
  for (const [k, prof] of parsed.entries()) {
    const c = companies.find((x) => !done.has(x.id) && normName(x.name) === normName(prof.input_name)) || companies.find((x, i) => !done.has(x.id) && i === k)
    if (!c) continue
    done.add(c.id)
    const { _start, _end, ...profile } = prof
    const verdict = assess(profile, { minRevenueUsd: Number(p.min_revenue_usd), localHqOnly: p.local_hq_only, altRevenueUsdMillion: c.alt_revenue_usd_million })
    await supabaseAdmin.from('ci_companies').update({
      profile, status: 'profiled', verdict, grounding: chunksForSpan(r.text, _start, _end, r.supports, r.chunks),
      updated_at: new Date().toISOString(),
    }).eq('id', c.id)
  }
  const left = companies.filter((c) => !done.has(c.id)).map((c) => c.id)
  if (left.length) {
    await supabaseAdmin.from('ci_tasks').update({ payload: { company_ids: left } }).eq('id', t.id)
    throw new RetryLater(`${left.length} of ${companies.length} companies missing from the reply`)
  }
  return { profiled: done.size }
}

async function execContacts(p: CiProject, t: CiTask, sys: string, deadline: number) {
  const ids = (t.payload as { company_ids: string[] }).company_ids
  const { data: cs } = await supabaseAdmin.from('ci_companies').select('id, name, profile').in('id', ids).eq('contacts_done', false)
  const companies = (cs || []) as Pick<CiCompany, 'id' | 'name' | 'profile'>[]
  if (!companies.length) return { researched: 0 }
  const r = await ground(p, t, deadline, { system: sys, user: contactsPrompt(p, companies.map((c) => ({ name: c.name, website: c.profile?.website, ceo: c.profile?.leader?.name }))), maxOutputTokens: 5000 })
  const parsed = parseContacts(r.text)
  let n = 0
  for (const [k, oc] of parsed.entries()) {
    const c = companies.find((x) => normName(x.name) === normName(oc.input_name.split(/\s+[—–-]\s+/)[0])) || companies[k]
    if (!c) continue
    const { input_name: _drop, ...raw } = oc
    await supabaseAdmin.from('ci_companies').update({ contacts_raw: raw, contacts_done: true, updated_at: new Date().toISOString() }).eq('id', c.id)
    n++
  }
  return { researched: n }
}

async function execVerify(p: CiProject, t: CiTask, deadline: number) {
  const ids = (t.payload as { company_ids: string[] }).company_ids
  const { data: cs } = await supabaseAdmin.from('ci_companies').select('*').in('id', ids).eq('verified', false)
  // A slow or hanging company site can take ~100s to check, so website checks
  // are bounded too: no new company is started near the step's deadline, and
  // every fetch stops at VERIFY_HARD_STOP_MS past it (inside Vercel's 300s).
  const get = makeFetcher(9000, deadline + VERIFY_HARD_STOP_MS)
  const left: string[] = []
  let n = 0
  for (const c of (cs || []) as CiCompany[]) {
    if (left.length || Date.now() > deadline - 20_000) { left.push(c.id); continue }
    if (!c.profile) continue
    const v = await verifyCompany(c, p.country, get)
    if (get.expired()) { left.push(c.id); continue } // cut short: re-check next step rather than save a half-checked company
    const profile = { ...c.profile, sources: v.sources, recent_developments: v.developments, revenue: c.profile.revenue ? { ...c.profile.revenue, source_url: v.revenueSource } : null, grounded_sources: v.grounded }
    await supabaseAdmin.from('ci_companies').update({ outreach: v.outreach, profile, verified: true, updated_at: new Date().toISOString() }).eq('id', c.id)
    n++
  }
  if (left.length) {
    await supabaseAdmin.from('ci_tasks').update({ payload: { company_ids: left } }).eq('id', t.id)
    throw new Defer(`${left.length} companies left for the next step`)
  }
  return { verified: n }
}

async function execute(p: CiProject, t: CiTask, sys: string, deadline: number): Promise<'done' | 'deferred' | 'other'> {
  const startCost = Number(t.cost_usd || 0)
  try {
    const result =
      t.kind === 'context' ? await execContext(p, t, sys, deadline)
      : t.kind === 'collect' ? await execCollect(p, t, sys, deadline)
      : t.kind === 'select' ? await execSelect(p, t, sys, deadline)
      : t.kind === 'profile' ? await execProfile(p, t, sys, deadline)
      : t.kind === 'contacts' ? await execContacts(p, t, sys, deadline)
      : await execVerify(p, t, deadline)
    await supabaseAdmin.from('ci_tasks').update({ status: 'done', result, cost_usd: t.cost_usd, searches: t.searches, error: null, finished_at: new Date().toISOString() }).eq('id', t.id)
    return 'done'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const base = { cost_usd: t.cost_usd ?? startCost, searches: t.searches, error: msg.slice(0, 500) }
    if (e instanceof Defer) {
      await supabaseAdmin.from('ci_tasks').update({ ...base, status: 'pending', attempts: Math.max(0, t.attempts - 1), locked_at: null }).eq('id', t.id)
      return 'deferred'
    } else if (e instanceof BudgetReached) {
      await supabaseAdmin.from('ci_tasks').update({ ...base, status: 'pending', attempts: Math.max(0, t.attempts - 1), locked_at: null }).eq('id', t.id)
      // The phase is kept, so raising the budget and resuming continues exactly where the run stopped.
      await supabaseAdmin.from('ci_projects').update({ status: 'paused', error: 'BUDGET: The budget for this run has been reached. Raise the budget to continue.' }).eq('id', p.id)
    } else if (e instanceof GeminiError && !e.retryable && e.code > 0) {
      // Key / billing / request problems will fail every task: pause the run with the reason instead of burning attempts.
      await supabaseAdmin.from('ci_tasks').update({ ...base, status: 'pending', attempts: Math.max(0, t.attempts - 1), locked_at: null }).eq('id', t.id)
      await supabaseAdmin.from('ci_projects').update({ status: 'paused', error: `Gemini rejected the request: ${msg.slice(0, 300)}` }).eq('id', p.id)
    } else {
      const giveUp = t.attempts >= MAX_ATTEMPTS
      await supabaseAdmin.from('ci_tasks').update({ ...base, status: giveUp ? 'failed' : 'pending', locked_at: null, finished_at: giveUp ? new Date().toISOString() : null }).eq('id', t.id)
      if (giveUp && (t.kind === 'profile' || t.kind === 'contacts')) {
        const ids = (t.payload as { company_ids?: string[] }).company_ids || []
        if (t.kind === 'profile' && ids.length) await supabaseAdmin.from('ci_companies').update({ status: 'failed' }).in('id', ids).eq('status', 'pending')
      }
    }
    return 'other'
  }
}

// ── one /step request ────────────────────────────────────────────────────────
export async function runStep(projectId: string): Promise<void> {
  const started = Date.now()
  const deadline = started + STEP_WINDOW_MS
  const sysBase = await loadSystemPrompt()
  for (;;) {
    let p = await getProject(projectId)
    if (!p || p.status !== 'running') return
    p = await plan(p)
    if (!p || p.status !== 'running') return
    if (Date.now() - started > CLAIM_CUTOFF_MS) return
    const { data: claimed, error } = await supabaseAdmin.rpc('ci_claim_tasks', { p_project: projectId, p_limit: CONCURRENCY })
    if (error) throw new Error(`could not claim work: ${error.message}`)
    const tasks = (claimed || []) as CiTask[]
    if (!tasks.length) {
      const { count } = await supabaseAdmin.from('ci_tasks').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('status', 'running')
      if (count) return // another request is working this project
      const again = await plan(p)
      if (!again || again.phase === p.phase && again.round === p.round) return // nothing left to plan
      continue
    }
    const sys = systemPrompt(sysBase, p)
    const outcomes = await Promise.all(tasks.map((t) => execute(p!, t, sys, deadline)))
    // Everything claimed was too big for the time left: end the step. Re-claiming
    // would only defer the same tasks again in a tight loop; the next step
    // starts with a full window.
    if (outcomes.every((o) => o === 'deferred')) return
  }
}

// ── progress summary for the workspace ──────────────────────────────────────
export async function summarize(projectId: string) {
  const [{ data: tasks }, { data: companies }] = await Promise.all([
    supabaseAdmin.from('ci_tasks').select('id, kind, round, status, attempts, cost_usd, searches, error, finished_at, payload').eq('project_id', projectId).order('created_at'),
    supabaseAdmin.from('ci_companies').select('id, origin, status, verdict, contacts_done, verified').eq('project_id', projectId),
  ])
  const byKind: Record<string, { total: number; done: number; failed: number; running: number }> = {}
  for (const t of tasks || []) {
    const k = (byKind[t.kind] ||= { total: 0, done: 0, failed: 0, running: 0 })
    k.total++
    if (t.status === 'done') k.done++
    else if (t.status === 'failed') k.failed++
    else if (t.status === 'running') k.running++
  }
  const cs = companies || []
  const passing = cs.filter((c) => (c.verdict as { pass?: boolean } | null)?.pass)
  const recent = (tasks || []).filter((t) => t.finished_at || t.error).sort((a, b) => String(b.finished_at || '').localeCompare(String(a.finished_at || ''))).slice(0, 14)
    .map((t) => ({ id: t.id, kind: t.kind, round: t.round, status: t.status, cost: Number(t.cost_usd || 0), searches: t.searches, error: t.error, finished_at: t.finished_at, size: ((t.payload as { company_ids?: string[] }).company_ids || []).length || undefined }))
  return {
    tasks: byKind,
    companies: {
      total: cs.length,
      profiled: cs.filter((c) => c.status === 'profiled').length,
      failed: cs.filter((c) => c.status === 'failed').length,
      passing: passing.length,
      clientOutside: cs.filter((c) => c.origin === 'client' && c.status === 'profiled' && !(c.verdict as { pass?: boolean } | null)?.pass).length,
      contactsDone: cs.filter((c) => c.contacts_done).length,
      verified: cs.filter((c) => c.verified).length,
    },
    recent,
  }
}
