import { supabaseAdmin } from '@/lib/supabase/admin'
import type { UsageWorkflow } from '@/types'

// Appends one immutable row to the usage_events ledger — the single source of
// truth for analytics. Called after every Claude operation (research,
// questions, transcript refine/translate). Best-effort: a logging failure must
// never break the user-facing operation, so errors are swallowed (and logged).
export async function logUsageEvent(event: {
  userId: string | null
  workflow: UsageWorkflow
  sourceId?: string | null
  model?: string | null
  tokensInput?: number
  tokensOutput?: number
  tokensTotal?: number
  webSearches?: number
  costUsd?: number
  status?: 'success' | 'error'
  error?: string | null
}): Promise<void> {
  try {
    await supabaseAdmin.from('usage_events').insert({
      user_id: event.userId,
      workflow: event.workflow,
      source_id: event.sourceId ?? null,
      model: event.model ?? null,
      tokens_input: event.tokensInput ?? 0,
      tokens_output: event.tokensOutput ?? 0,
      tokens_total: event.tokensTotal ?? 0,
      web_searches: event.webSearches ?? 0,
      cost_usd: event.costUsd ?? 0,
      status: event.status ?? 'success',
      error: event.error ?? null,
    })
  } catch (err) {
    console.error('Failed to log usage event:', err)
  }
}
