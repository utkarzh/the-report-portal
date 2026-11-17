import { supabaseAdmin } from '@/lib/supabase/admin'
import { FALLBACK_AGENCIES, toAgencyOption, type AgencyOption } from '@/lib/agencies'
import type { Agency } from '@/types'

// Server-side reads of the central agency list (migration 047). Every query
// falls back to the two formerly hard-coded agencies when the table or its
// `code` column doesn't exist yet, so modules behave exactly as before until
// the migration runs.

const COLUMNS = 'id, name, code, active, sort_order, created_at, updated_at'

export async function listAgencies(opts: { activeOnly?: boolean } = {}): Promise<Agency[]> {
  let q = supabaseAdmin.from('agencies').select(COLUMNS).order('sort_order').order('name')
  if (opts.activeOnly) q = q.eq('active', true)
  const { data, error } = await q
  if (error) return opts.activeOnly ? FALLBACK_AGENCIES.filter((a) => a.active) : FALLBACK_AGENCIES
  return (data || []) as Agency[]
}

export async function agencyByCode(code: string | null | undefined): Promise<Agency | null> {
  if (!code) return null
  const { data, error } = await supabaseAdmin.from('agencies').select(COLUMNS).eq('code', code).maybeSingle()
  if (error) return FALLBACK_AGENCIES.find((a) => a.code === code) ?? null
  return (data as Agency | null) ?? null
}

export async function agencyOptions(opts: { activeOnly?: boolean } = { activeOnly: true }): Promise<AgencyOption[]> {
  return (await listAgencies(opts)).map(toAgencyOption)
}
