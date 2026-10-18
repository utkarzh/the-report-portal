// Shared types for the Country Intelligence module (Commercial). See CLAUDE.md
// "Country Intelligence module" and migration 037.

export type CiDepth = 'quick' | 'standard' | 'deep'
export type CiStatus = 'draft' | 'running' | 'paused' | 'complete' | 'failed'
export type CiPhase =
  | 'queued'
  | 'context_discovery'
  | 'selecting'
  | 'profiling'
  | 'contacts'
  | 'verifying'
  | 'done'
  | 'budget_reached'
export type CiTaskKind = 'context' | 'collect' | 'select' | 'profile' | 'contacts' | 'verify'

export interface CiSector {
  name: string
  scope: string
}

export interface CiProject {
  id: string
  user_id: string | null
  title: string
  country: string
  brief: string
  sectors: CiSector[]
  target_count: number
  depth: CiDepth
  min_revenue_usd: number
  local_hq_only: boolean
  include_contacts: boolean
  include_context: boolean
  status: CiStatus
  phase: CiPhase
  round: number
  budget_usd: number
  spent_usd: number
  context: CiContext | null
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface CiRevenue {
  amount: string
  currency: string
  year: string
  usd: string
  status: 'Verified' | 'Unverified'
  source_url: string
}

export interface CiProfile {
  input_name: string
  name: string
  website: string
  subsector: string
  headquarters: string
  ownership: string
  foreign_parent: string
  hq_in_country: boolean
  company_narrative: string
  leader: { name: string; title: string; since: string; trajectory: string; public_statements: string; interview_hooks: string }
  revenue: CiRevenue | null
  scale_indicators: string[]
  international_operations: string
  sector_ranking: string
  recent_developments: { date: string; text: string; source_url: string }[]
  government_connection: string
  theme_relevance: string
  cross_border_links: string
  model_qualification: string
  qualification_basis: string
  priority: string
  reason_for_inclusion: string
  contacts: { name: string; role: string; phone: string; email: string; source_url: string }[]
  switchboard: { phone: string; email: string; address: string; source_url: string } | null
  sources: { title: string; url: string; date: string }[]
  grounded_sources?: { title: string; url: string }[]
}

export type CiCheck = 'source' | 'website' | 'unconfirmed'

export interface CiContactEntry {
  kind: 'person' | 'office' | 'switchboard'
  name: string
  role: string
  phone: string
  mobile: string
  email: string
  address?: string
  source_url: string
  ask_for?: string
  checks: Partial<Record<'phone' | 'mobile' | 'email' | 'name', CiCheck>>
}

export interface CiOutreach {
  primary: CiContactEntry | null
  people: CiContactEntry[]
  offices: CiContactEntry[]
  switchboard: CiContactEntry | null
  approach: string
}

export interface CiVerdict {
  pass: boolean
  label: 'Qualified' | 'Likely qualified' | 'Outside criteria'
  reason: string
  conflict?: boolean
  revenue_usd?: number | null
}

export interface CiCompany {
  id: string
  project_id: string
  name: string
  norm_name: string
  origin: 'client' | 'discovered'
  sector: string | null
  hint: string | null
  round: number
  status: 'pending' | 'profiled' | 'failed'
  profile: CiProfile | null
  grounding: { title: string; uri: string }[] | null
  contacts_raw: CiRawContacts | null
  outreach: CiOutreach | null
  verdict: CiVerdict | null
  alt_revenue_usd_million: number | null
  contacts_done: boolean
  verified: boolean
  created_at: string
}

export interface CiRawContacts {
  people: { name: string; role: string; phone: string; mobile: string; email: string; source_url: string; ask_for: string }[]
  offices: { name: string; phone: string; email: string; source_url: string }[]
  switchboard: { phone: string; email: string; address: string; source_url: string } | null
  approach: string
}

export interface CiContextRow {
  [key: string]: string
}

export interface CiContext {
  narrative?: CiContextRow[]
  key_figures?: CiContextRow[]
  government?: CiContextRow[]
  institutions?: CiContextRow[]
  events?: CiContextRow[]
  bilateral?: CiContextRow[]
  sources?: Record<string, { title: string; uri: string }[]>
}

export interface CiTask {
  id: string
  project_id: string
  kind: CiTaskKind
  round: number
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  status: 'pending' | 'running' | 'done' | 'failed'
  attempts: number
  cost_usd: number
  searches: number
  error: string | null
  locked_at: string | null
  finished_at: string | null
  created_at: string
}
