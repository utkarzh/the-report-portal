import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { getAnthropicClient } from '@/lib/claude/client'
import { calculateCost, parseUsage, totalPromptTokens } from '@/lib/claude/tokens'
import { composeFinalDocument, finalSectionsOf } from '@/lib/meeting-prep-document'
import {
  MEETING_PREP_SAMPLE_AUDIO_BUCKET,
  MEETING_PREP_SAMPLE_AUDIO_PATH,
  type MeetingPrepResourceSlot,
} from '@/lib/meeting-prep'
import type { MeetingPrepFinalSections, MeetingPrepSession } from '@/types'

// Server-only helpers shared by the meeting-prep API routes and pages.

// ── Migration 044 compatibility ──────────────────────────────────────────
// Code deployed before 044 runs must keep the CEO and Government flows
// working: a write naming a 044 column is retried without them. The
// aperturador route itself needs 044 (its CHECK constraint), and says so.

export const MIGRATION_044_COLUMNS = ['final_sections', 'auto_pipeline'] as const

export const MIGRATION_044_MESSAGE =
  'This needs the latest Meeting Preparation database update (supabase/migrations/044_meeting_prep_single_document_apertura.sql). Ask an admin to run it.'

interface PgError {
  code?: string
  message?: string
}

// PGRST204 = an INSERT/UPDATE names a column that doesn't exist; 42703 = a
// SELECT/filter does.
export function isMissing044Column(error: PgError | null | undefined): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  return (
    (error.code === 'PGRST204' || error.code === '42703' || /does not exist|could not find/i.test(msg)) &&
    MIGRATION_044_COLUMNS.some((c) => msg.includes(c))
  )
}

// A CHECK violation on interviewee_type / variant / prompt_key before 044.
export function isPre044CheckViolation(error: PgError | null | undefined): boolean {
  return !!error && error.code === '23514'
}

function without044<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row }
  for (const c of MIGRATION_044_COLUMNS) delete copy[c]
  return copy
}

// UPDATE one session. With `whereStage` it is a compare-and-set: it only
// applies while the row is still at that stage, and `rows` says whether it
// did. Retries without the 044 columns on a pre-044 database.
export async function updateMeetingPrep(
  id: string,
  updates: Record<string, unknown>,
  opts: { whereStage?: string | string[] } = {},
): Promise<{ ok: boolean; rows: number; error?: string }> {
  async function run(payload: Record<string, unknown>) {
    let q = supabaseAdmin.from('meeting_prep_sessions').update(payload).eq('id', id)
    if (Array.isArray(opts.whereStage)) q = q.in('stage', opts.whereStage)
    else if (opts.whereStage) q = q.eq('stage', opts.whereStage)
    return q.select('id')
  }
  let { data, error } = await run(updates)
  if (error && isMissing044Column(error)) {
    const stripped = without044(updates)
    if (Object.keys(stripped).length === 0) return { ok: true, rows: 0 }
    ;({ data, error } = await run(stripped))
  }
  if (error) return { ok: false, rows: 0, error: error.message }
  return { ok: true, rows: data?.length ?? 0 }
}

// Moves a session from one checkpoint to its in-progress stage, only if no
// other request got there first (two open tabs, a double click).
export async function claimStage(id: string, from: string | string[], to: string): Promise<boolean> {
  const res = await updateMeetingPrep(id, { stage: to, error: null }, { whereStage: from })
  return res.ok && res.rows > 0
}

// Adds one call's usage to the session totals in a single statement, so two
// requests finishing together can't drop one of the two updates. Falls back
// to read-then-write before migration 044 adds the function.
export async function addSessionUsage(
  id: string,
  u: { tokensInput: number; tokensOutput: number; webSearches?: number; cost: number },
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('meeting_prep_add_usage', {
    p_session: id,
    p_tokens_input: Math.round(u.tokensInput) || 0,
    p_tokens_output: Math.round(u.tokensOutput) || 0,
    p_web_searches: u.webSearches || 0,
    p_cost: u.cost || 0,
  })
  if (!error) return
  const { data: s } = await supabaseAdmin
    .from('meeting_prep_sessions')
    .select('tokens_input, tokens_output, tokens_total, web_searches, cost_usd')
    .eq('id', id)
    .single()
  if (!s) return
  await supabaseAdmin
    .from('meeting_prep_sessions')
    .update({
      tokens_input: (s.tokens_input || 0) + u.tokensInput,
      tokens_output: (s.tokens_output || 0) + u.tokensOutput,
      tokens_total: (s.tokens_total || 0) + u.tokensInput + u.tokensOutput,
      web_searches: (s.web_searches || 0) + (u.webSearches || 0),
      cost_usd: Number(s.cost_usd || 0) + u.cost,
    })
    .eq('id', id)
}

export const currentFinalSections = finalSectionsOf

// Saves the blocks and the whole document together, so a database without
// the final_sections column (pre-044) still keeps the edit in final_output.
export async function saveFinalSections(session: MeetingPrepSession, sections: MeetingPrepFinalSections): Promise<string> {
  const output = composeFinalDocument({ ...session, final_sections: sections })
  await updateMeetingPrep(session.id, { final_sections: sections, final_output: output })
  return output
}

// Keeps final_output (the whole document as markdown) in step after a
// points/planteo change. The download composes its own copy, so
// this is for anything else that reads the column.
export async function refreshFinalOutput(id: string): Promise<void> {
  const { data: s } = await supabaseAdmin.from('meeting_prep_sessions').select('*').eq('id', id).single()
  if (!s || s.stage !== 'complete') return
  const sections = currentFinalSections(s)
  if (!Object.keys(sections).length) return
  await supabaseAdmin.from('meeting_prep_sessions').update({ final_output: composeFinalDocument({ ...s, final_sections: sections }) }).eq('id', id)
}

// ── Route guards ─────────────────────────────────────────────────────────

export interface MeetingPrepCaller {
  user: { id: string }
  profile: { id: string; role: string; status: string; tokens_used: number; token_limit: number; full_name?: string | null }
}

// Active user with Meeting Prep access and, for AI calls, enough budget left
// for `reserve` tokens (checked before any spend).
export async function requireMeetingPrepCaller(reserve = 0): Promise<MeetingPrepCaller | { response: NextResponse }> {
  const auth = await getApiUser()
  if (!auth.user) return { response: auth.response }
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, tokens_used, token_limit, full_name, can_access_meeting_preparation')
    .eq('id', auth.user.id)
    .single()
  if (!profile || profile.status !== 'active') {
    return { response: NextResponse.json({ error: 'Account inactive' }, { status: 403 }) }
  }
  if (profile.role !== 'admin' && !profile.can_access_meeting_preparation) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (reserve > 0 && profile.role === 'user' && profile.token_limit - profile.tokens_used < reserve) {
    return { response: NextResponse.json({ error: 'Not enough token budget remaining' }, { status: 402 }) }
  }
  return { user: auth.user, profile }
}

export async function loadOwnedSession(
  id: string,
  caller: MeetingPrepCaller,
): Promise<{ session: MeetingPrepSession } | { response: NextResponse }> {
  const { data: session } = await supabaseAdmin.from('meeting_prep_sessions').select('*').eq('id', id).single()
  if (!session) return { response: NextResponse.json({ error: 'Session not found' }, { status: 404 }) }
  if (session.user_id !== caller.user.id && caller.profile.role !== 'admin') {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session: session as MeetingPrepSession }
}

// ── Planteo files: the reference recording and the apertura samples ──────

const BUCKET = MEETING_PREP_SAMPLE_AUDIO_BUCKET

// The reference recording (migration 030's fixed path), shown under the
// planteo script. Null when it hasn't been uploaded.
export async function sampleRecordingUrl(): Promise<string | null> {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(MEETING_PREP_SAMPLE_AUDIO_PATH, 60 * 60)
  return data?.signedUrl ?? null
}

export function resourceFolder(slot: MeetingPrepResourceSlot): string {
  return `resources/${slot}`
}

export interface ResourceFile {
  path: string
  name: string
  size: number | null
  updatedAt: string | null
}

// The file an apertura sample slot currently holds: the newest object in
// its folder.
export async function getResourceFile(slot: MeetingPrepResourceSlot): Promise<ResourceFile | null> {
  const folder = resourceFolder(slot)
  const { data } = await supabaseAdmin.storage.from(BUCKET).list(folder, { limit: 20, sortBy: { column: 'created_at', order: 'desc' } })
  const file = (data || []).find((f) => f.id && f.name !== '.emptyFolderPlaceholder')
  if (!file) return null
  const meta = (file.metadata || {}) as { size?: number }
  return {
    path: `${folder}/${file.name}`,
    // Stored as "<timestamp>-<original name>".
    name: file.name.replace(/^\d{10,}-/, ''),
    size: typeof meta.size === 'number' ? meta.size : null,
    updatedAt: file.created_at ?? file.updated_at ?? null,
  }
}

export async function signResourcePath(path: string, opts: { downloadName?: string; seconds?: number } = {}): Promise<string | null> {
  const { data } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, opts.seconds ?? 60 * 60, opts.downloadName ? { download: opts.downloadName } : undefined)
  return data?.signedUrl ?? null
}

// Which apertura sample files exist, for the planteo's download links.
export async function aperturaSamplesAvailable(): Promise<{ apertura_letter: boolean; apertura_list: boolean }> {
  const [letter, list] = await Promise.all([getResourceFile('apertura_letter'), getResourceFile('apertura_list')])
  return { apertura_letter: Boolean(letter), apertura_list: Boolean(list) }
}

// ── Streaming a call that must finish inside the request ─────────────────
// One Claude call (optionally with web search) aborted by a timer before
// Vercel's hard cap, so the caller always gets to save and bill. Usage is
// read from stream events, because finalMessage() rejects after an abort;
// a pass cut short never sees output_tokens (it only arrives on
// message_delta), so its output is recounted with countTokens on the text
// received — the Usage ledger rule in CLAUDE.md.
export async function streamWithDeadline(opts: {
  model: string
  system: string
  user: string
  maxTokens: number
  maxSearches?: number
  deadlineMs: number
}): Promise<{ text: string; promptTokens: number; outputTokens: number; webSearches: number; cost: number; cutShort: boolean }> {
  const anthropic = getAnthropicClient()
  const stream = anthropic.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
    ...(opts.maxSearches
      ? { tools: [{ type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: opts.maxSearches }] }
      : {}),
  })
  let aborted = false
  const timer = setTimeout(() => {
    aborted = true
    try { stream.abort() } catch {}
  }, opts.deadlineMs)

  let text = ''
  let startUsage: Record<string, unknown> = {}
  let outputTokens = 0
  let sawFinal = false
  let searches = 0
  let reportedSearches: number | undefined
  try {
    for await (const event of stream) {
      if (event.type === 'message_start') {
        startUsage = (event.message.usage ?? {}) as unknown as Record<string, unknown>
      } else if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
        searches += 1
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      } else if (event.type === 'message_delta') {
        const du = event.usage as { output_tokens?: number; server_tool_use?: { web_search_requests?: number } } | undefined
        if (typeof du?.output_tokens === 'number') {
          outputTokens = du.output_tokens
          sawFinal = true
        }
        if (typeof du?.server_tool_use?.web_search_requests === 'number') reportedSearches = du.server_tool_use.web_search_requests
      }
    }
  } catch (e) {
    if (!aborted) {
      clearTimeout(timer)
      throw e
    }
  } finally {
    clearTimeout(timer)
  }

  if (!sawFinal && text.trim()) {
    try {
      const counted = await anthropic.messages.countTokens({ model: opts.model, messages: [{ role: 'user', content: text }] })
      outputTokens = counted.input_tokens
    } catch (err) {
      console.error('Meeting prep output-token recount failed:', err)
    }
  }

  const usage = parseUsage({ ...startUsage, output_tokens: outputTokens }, reportedSearches ?? searches)
  return {
    text,
    promptTokens: totalPromptTokens(usage),
    outputTokens: usage.outputTokens,
    webSearches: usage.webSearches ?? 0,
    cost: calculateCost(usage),
    cutShort: aborted,
  }
}
