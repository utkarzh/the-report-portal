export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'inactive'
export type InviteStatus = 'pending' | 'accepted' | 'expired'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  status: UserStatus
  token_limit: number | null // null = no limit (admins)
  tokens_used: number
  // Per-module access for normal users. Admins always have full access and
  // ignore these flags.
  can_access_interview: boolean
  can_access_transcriptions: boolean
  created_at: string
  updated_at: string
}

export interface Invitation {
  id: string
  email: string
  role: UserRole
  token_limit: number | null // null = no limit (admins)
  can_access_interview: boolean
  can_access_transcriptions: boolean
  token: string
  status: InviteStatus
  invited_by: string | null
  accepted_by: string | null
  created_at: string
  expires_at: string
  accepted_at: string | null
}

export interface Category {
  id: string
  name: string
  description: string | null
  prompt_text: string
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface GeneralPrompt {
  id: string
  prompt_text: string
  updated_by: string | null
  updated_at: string
}

export interface ResearchSession {
  id: string
  user_id: string | null
  category_id: string | null
  category_name: string
  full_name: string | null
  title_position: string | null
  company_org: string | null
  country_focus: string | null
  publication: string | null
  media_partner_country: string | null
  initial_output: string | null
  questions_output: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  web_searches: number
  cost_usd: number
  general_prompt_snapshot: string | null
  category_prompt_snapshot: string | null
  created_at: string
  updated_at: string
}

export interface ResearchFormData {
  categoryId: string
  fullName: string
  titlePosition: string
  companyOrg: string
  countryFocus: string
  publication: string
  mediaPartnerCountry: string
}

export interface TranscriptPrompt {
  id: string
  prompt_text: string
  updated_by: string | null
  updated_at: string
}

export type TranscriptionStatus =
  | 'uploaded'
  | 'transcribing'
  | 'transcribed'
  | 'refining'
  | 'refined'
  | 'failed'

export interface Transcription {
  id: string
  user_id: string | null
  title: string
  audio_path: string
  chunk_paths: string[] | null
  chunk_transcripts: (string | null)[] | null
  audio_filename: string | null
  audio_mime: string | null
  audio_size_bytes: number | null
  duration_seconds: number | null
  status: TranscriptionStatus
  raw_transcript: string | null
  refined_transcript: string | null
  refining_prompt_snapshot: string | null
  transcribe_model: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  cost_usd: number
  error: string | null
  created_at: string
  updated_at: string
}

export interface PromptVersion {
  id: string
  prompt_text: string
  saved_by: string | null
  saved_by_email?: string | null
  created_at: string
}

export interface CategoryPromptVersion {
  id: string
  category_id: string
  prompt_text: string
  saved_by: string | null
  saved_by_email?: string | null
  created_at: string
}

export interface LoginAuditLog {
  id: string
  user_id: string | null
  email: string
  full_name: string | null
  user_role: UserRole | null
  ip_address: string | null
  location: string | null
  country: string | null
  user_agent: string | null
  login_method: 'password' | 'otp' | null
  created_at: string
}

export interface AnalyticsSummary {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
}

export interface UserAnalytics {
  userId: string
  fullName: string | null
  email: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}
