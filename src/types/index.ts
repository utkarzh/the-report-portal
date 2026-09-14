export type UserRole = 'admin' | 'user'
export type UserStatus = 'active' | 'inactive'
export type InviteStatus = 'pending' | 'accepted' | 'expired'

// Finance module (Cash Box) — see docs/cashbox-requirements.md. Deliberately
// NOT folded into role: platform admins keep full access via role === 'admin'
// (see canAccessFinance/isFinanceAdmin in src/lib/access.ts); finance_role is
// how everyone else gets in. null = no finance access at all.
export type FinanceRole = 'finance_admin' | 'field' | null

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
  can_access_business_cases: boolean
  can_access_editorial_briefs: boolean
  can_access_meeting_preparation: boolean
  can_access_interview_letter_generator: boolean
  can_access_sales_negotiation_coach: boolean
  finance_role: FinanceRole
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
  can_access_business_cases: boolean
  can_access_editorial_briefs: boolean
  can_access_meeting_preparation: boolean
  can_access_interview_letter_generator: boolean
  can_access_sales_negotiation_coach: boolean
  finance_role: FinanceRole
  token: string
  status: InviteStatus
  invited_by: string | null
  accepted_by: string | null
  created_at: string
  expires_at: string
  accepted_at: string | null
}

// ------------------------------------------------------------
// Cash Box (finance) module
// ------------------------------------------------------------
export type FinanceProjectStatus = 'active' | 'closed'
export type FinanceProjectRole = 'director' | 'sales_rep'
export type FinanceExpenseCategory =
  | 'transport'
  | 'accommodation'
  | 'communications'
  | 'other_services'
  | 'printing_office'
  | 'bank_charges'
export type FinanceExpenseStatus = 'pending' | 'verified' | 'rejected'
export type FinanceFlagSeverity = 'info' | 'warn' | 'crit'

// Title-case renderings of the client's own category headers (see
// EXCEL_CATEGORY_HEADERS in finance-categories.ts, which is the same
// wording verbatim in the ALL-CAPS form her Excel template uses) — kept in
// sync on purpose so the on-screen category names match the document she
// supplied, not a paraphrase invented before we had it.
export const FINANCE_EXPENSE_CATEGORY_LABELS: Record<FinanceExpenseCategory, string> = {
  transport: 'Transport / Trips',
  accommodation: 'Accommodation',
  communications: 'Communication',
  other_services: 'Other Professional Services',
  printing_office: 'Information / Materials',
  bank_charges: 'Bank Expenses',
}

export interface FinanceProject {
  id: string
  name: string
  country: string
  settlement_currency: 'USD' | 'EUR'
  exchange_rate: number
  media_publication: string
  local_currency: string
  // Admin-authored, project-specific rules (e.g. "no taxi over $40", "ignore
  // weekend expenses") fed into both AI receipt passes as strict
  // requirements — see lib/finance-ai.ts. Empty string = no extra rules.
  ai_rules: string
  status: FinanceProjectStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface FinanceProjectMember {
  id: string
  project_id: string
  user_id: string
  project_role: FinanceProjectRole
  added_by: string | null
  created_at: string
  // Joined convenience fields, populated by the API layer, not the DB row.
  full_name?: string | null
  email?: string | null
}

export interface FinanceFunding {
  id: string
  project_id: string
  amount: number
  date_sent: string
  proof_image_path: string
  recorded_by: string | null
  created_at: string
}

export interface FinanceExpense {
  id: string
  project_id: string
  logged_by: string | null
  // Snapshotted at logging time, not just a live join — so removing this
  // person from the project, or deleting their account outright, never
  // makes their past expenses show up nameless.
  logged_by_name: string
  category: FinanceExpenseCategory
  sub_line: string | null
  concept: string
  expense_date: string
  reference: string | null
  vendor: string | null
  local_amount: number
  local_currency: string
  exchange_rate_used: number
  settlement_amount: number
  receipt_file_path: string | null
  receipt_id: string | null
  nights: number | null
  prior_approval_granted: boolean
  caja_id: string | null
  // The AI's always-present, one-line take on the receipt (see finance-ai.ts)
  // — what Finance reads in the transaction list instead of opening the image.
  ai_note: string | null
  status: FinanceExpenseStatus
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface FinanceExpenseFlag {
  id: string
  expense_id: string
  flag_type: string
  severity: FinanceFlagSeverity
  message: string
  resolved: boolean
  created_at: string
}

export interface FinanceReceipt {
  id: string
  project_id: string
  uploaded_by: string | null
  file_path: string
  file_type: string
  ai_extraction: unknown
  created_at: string
}

// ------------------------------------------------------------
// Weekly caja (Phase 2) — brief Epic F
// ------------------------------------------------------------
export type FinanceCajaStage =
  | 'draft'
  | 'ready'
  | 'submitted'
  | 'under_review'
  | 'incidents'
  | 'resubmitted'
  | 'approved'
  | 'closed'
export type FinanceAuditVerdict = 'pass' | 'pass_with_observations' | 'review_required' | 'high_risk'

export interface FinanceCaja {
  id: string
  project_id: string
  week_number: number
  week_start: string
  week_end: string
  stage: FinanceCajaStage
  cash_confirmed_amount: number | null
  cash_confirmed_at: string | null
  cash_confirmed_by: string | null
  submitted_at: string | null
  submitted_by: string | null
  approved_at: string | null
  approved_by: string | null
  audit_verdict: FinanceAuditVerdict | null
  audit_report: string | null
  created_at: string
  updated_at: string
}

export interface FinanceCajaEvent {
  id: string
  caja_id: string
  from_stage: string | null
  to_stage: string
  comment: string | null
  actor_id: string | null
  created_at: string
}

// ------------------------------------------------------------
// Incidents (Phase 2) — brief Epic G
// ------------------------------------------------------------
export type FinanceIncidentStatus = 'open' | 'resolved'

export interface FinanceIncident {
  id: string
  caja_id: string
  expense_id: string | null
  description: string
  required_action: string
  due_date: string | null
  status: FinanceIncidentStatus
  created_by: string | null
  created_at: string
}

export interface FinanceIncidentMessage {
  id: string
  incident_id: string
  author_id: string | null
  message: string
  created_at: string
  author_name?: string | null
}

// ------------------------------------------------------------
// Inter-project transfers (Phase 2) — brief Epic J
// ------------------------------------------------------------
export interface FinanceTransfer {
  id: string
  from_project_id: string
  to_project_id: string
  amount: number
  reason: string
  created_by: string | null
  created_at: string
}

export interface FinanceNotification {
  id: string
  user_id: string
  type: string
  message: string
  link: string | null
  read: boolean
  created_at: string
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
  status: ResearchStatus
  created_at: string
  updated_at: string
}

export type ResearchStatus = 'pending' | 'generating' | 'complete' | 'failed'

// The distinct Claude-billed operations we log to the usage_events ledger.
export type UsageWorkflow =
  | 'research'
  | 'research_questions'
  | 'transcript_refine'
  | 'transcript_translate'
  | 'business_case'
  | 'editorial_brief'
  | 'input_validation'
  | 'meeting_prep_research'
  | 'meeting_prep_points'
  | 'meeting_prep_planteo'
  | 'meeting_prep_final_document'
  | 'finance_receipt_extraction'
  | 'finance_receipt_verification'
  | 'finance_audit_report'
  | 'interview_letter_research'
  | 'interview_letter_letter'
  | 'interview_letter_email'
  | 'interview_letter_personalize'
  | 'interview_letter_template_generate'
  | 'sales_coach_coach'
  | 'sales_coach_report_card'

export interface UsageEvent {
  id: string
  user_id: string | null
  workflow: UsageWorkflow
  source_id: string | null
  model: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  web_searches: number
  cost_usd: number
  status: 'success' | 'error'
  error: string | null
  created_at: string
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

// Company document attached to an interview (research session) and used as
// supporting context during research + question generation.
export interface ResearchDocument {
  id: string
  session_id: string
  user_id: string | null
  filename: string
  storage_path: string
  mime: string | null
  size_bytes: number | null
  extracted_text: string
  char_count: number
  truncated: boolean
  created_at: string
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
  // Interviewee metadata, required at upload — feeds the standardised
  // "Interview Transcript" document header at export time.
  full_name: string
  title_position: string
  company_org: string
  publication: string
  status: TranscriptionStatus
  raw_transcript: string | null
  refined_transcript: string | null
  refining_prompt_snapshot: string | null
  // Optional topic-outline document attached at upload (extracted text + its
  // original filename). Used as supporting context during refine.
  topic_outline: string | null
  topic_outline_filename: string | null
  // Single translation slot (one of the TRANSLATION_LANGUAGES); overwritten on re-translate.
  translated_transcript: string | null
  translation_language: string | null
  transcribe_model: string | null
  // Provider job id for async transcription (AssemblyAI). NULL for the OpenAI path.
  transcribe_job_id: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  cost_usd: number
  error: string | null
  created_at: string
  updated_at: string
}

// ── Business Cases / Editorial Briefs modules ──────────────────────────────
export type DocType = 'business_case' | 'editorial_brief'

export type DocumentStatus = 'pending' | 'generating' | 'complete' | 'failed'

export interface DocumentSession {
  id: string
  user_id: string | null
  doc_type: DocType
  title: string
  project_country: string | null
  media_partner: string | null
  media_country: string | null
  additional_context: string | null
  output: string | null
  prompt_snapshot: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  web_searches: number
  cost_usd: number
  status: DocumentStatus
  error: string | null
  created_at: string
  updated_at: string
}

export interface DocumentPrompt {
  id: string
  doc_type: DocType
  prompt_text: string
  updated_by: string | null
  updated_at: string
}

export interface DocumentSample {
  id: string
  doc_type: DocType
  filename: string
  storage_path: string
  mime: string | null
  size_bytes: number | null
  extracted_text: string
  char_count: number
  truncated: boolean
  uploaded_by: string | null
  created_at: string
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

// ── Commercial Meeting Preparation module ──────────────────────────────────
export type InterviewType = 'company_ceo' | 'government_official'

export type MeetingPrepStage =
  | 'input'
  | 'researching'
  | 'awaiting_review'
  | 'points_generating'
  | 'points_pending'
  | 'planteo_generating'
  | 'planteo_pending'
  | 'final_generating'
  | 'complete'
  | 'failed'

export interface MeetingPrepResearchSections {
  interviewee?: string
  organisation?: string
  motivation_profiles?: string
  quotes_news?: string
}

export interface MeetingPrepSession {
  id: string
  user_id: string | null
  interviewee_name: string
  interviewee_title: string
  interviewee_type: InterviewType
  company_org: string
  company_country: string
  publication: string
  publication_country: string
  media_library_id: string | null
  media_positioning_snapshot: string | null
  media_audience_reach_snapshot: string | null
  media_narrative_snapshot: string | null
  advertiser_history_status: 'yes' | 'no' | 'not_aware' | null
  advertiser_history_details: string | null
  research_sections: MeetingPrepResearchSections
  presentation_points: string[]
  planteo_output: string | null
  final_output: string | null
  research_prompt_snapshot: string | null
  points_prompt_snapshot: string | null
  planteo_prompt_snapshot: string | null
  final_doc_prompt_snapshot: string | null
  planteo_library_snapshot: string | null
  stage: MeetingPrepStage
  error: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  web_searches: number
  cost_usd: number
  created_at: string
  updated_at: string
}

export interface MeetingPrepMediaLibraryEntry {
  id: string
  publication_name: string
  positioning_statement: string
  audience_reach: string
  editorial_narrative_focus: string
  country_of_publication: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface MeetingPrepPlanteoLibraryEntry {
  id: string
  variant: InterviewType
  template_text: string
  updated_by: string | null
  updated_at: string
}

export type MeetingPrepPromptKey = 'research' | 'presentation_points' | 'planteo' | 'final_document'

export interface MeetingPrepPrompt {
  id: string
  prompt_key: MeetingPrepPromptKey
  prompt_text: string
  updated_by: string | null
  updated_at: string
}

// ── Interview Request Letter & Email Generator (Module 5) ─────────────────
export type InterviewLetterCompany = 'TRC' | 'GFDI'

export type InterviewLetterStage =
  | 'input'
  | 'researching'
  | 'hook_review'
  | 'letter_generating'
  | 'letter_review'
  | 'letter_approved'
  | 'email_generating'
  | 'email_review'
  | 'complete'
  | 'failed'

export type InterviewLetterParagraphType = 'fixed' | 'variable'

// Shape of one slot inside a template's `structure` array.
export interface InterviewLetterParagraphSlot {
  key: string
  type: InterviewLetterParagraphType
  label: string
  content?: string // fixed slots only — immutable wording
  instructions?: string // variable slots only — what the model should write
  wordBudget?: number // variable slots only
}

// Shape of one entry inside a project's `paragraphs` array — the template
// slot plus per-project generation state.
export interface InterviewLetterParagraph extends InterviewLetterParagraphSlot {
  content: string
  status: 'pending' | 'locked'
  lastFeedback?: string
}

export interface InterviewLetterTemplate {
  id: string
  company: InterviewLetterCompany
  structure: InterviewLetterParagraphSlot[]
  updated_by: string | null
  updated_at: string
}

export interface InterviewLetterProject {
  id: string
  user_id: string | null
  company: InterviewLetterCompany
  project_country: string
  media_partner: string
  media_partner_country: string
  hook_input: string
  // Who this project's cover email is from — supplied per project (Screen 1)
  // since the real sender varies by project/reporter, unlike the letter's
  // fixed per-company template.
  sender_name: string
  sender_title: string
  sender_contact: string
  // Bullet strings, each already carrying its own inline "[Source, date](url)"
  // markdown citation — same convention as the rest of the app (meeting-prep,
  // documents): sources live inline in the text, not as a separate structured
  // field. See templateStructureToPrompt / research route.
  research: string[]
  hook_ai_suggestion: string | null
  confirmed_hook: string | null
  hook_source: 'user' | 'ai' | null
  template_structure_snapshot: InterviewLetterParagraphSlot[] | null
  paragraphs: InterviewLetterParagraph[]
  master_letter: string | null
  master_email: string | null
  research_prompt_snapshot: string | null
  letter_prompt_snapshot: string | null
  email_prompt_snapshot: string | null
  stage: InterviewLetterStage
  error: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  web_searches: number
  cost_usd: number
  created_at: string
  updated_at: string
}

export interface InterviewLetterPersonalization {
  id: string
  project_id: string
  recipient_name: string | null
  recipient_title: string | null
  recipient_organisation: string | null
  recipient_sector: string | null
  recipient_context: string | null
  letter_text: string
  email_text: string
  tokens_total: number
  cost_usd: number
  created_by: string | null
  created_at: string
}

// ------------------------------------------------------------
// Sales Negotiation Coach module (US-033→048)
// ------------------------------------------------------------
export type SalesCoachKnowledgeKey = 'project_prompt' | 'manual' | 'method' | 'examples'
export type SalesCoachOutcome = 'signed' | 'retorno' | 'lost' | 'uncertain'
export type SalesCoachStage =
  | 'draft' | 'transcribing' | 'transcribed' | 'analyzing' | 'complete' | 'failed'

// The brief's qualifier-based AI-assessed commercial position values (US-040).
export type SalesCoachAssessedPosition =
  | 'Positive/Won'
  | 'Apparent Positive/Won — confirmation required'
  | 'Controlled retorno'
  | 'Open retorno'
  | 'Open, low-confidence retorno'
  | 'Negative/Lost'
  | 'Uncertain — insufficient evidence'
  | 'Management review recommended'

export interface SalesCoachParticipant {
  name: string
  // "position" for company reps, "role" for TRC members — both stored here.
  role: string
}

export interface SalesCoachKnowledgeDoc {
  id: string
  doc_key: SalesCoachKnowledgeKey
  content: string
  updated_by: string | null
  updated_at: string
}

// One evaluated criterion in the structured Report Card (9 fixed criteria,
// see SALES_COACH_CRITERIA in lib/sales-coach.ts).
export type SalesCoachVerdict = 'pass' | 'warn' | 'fail' | 'na' | 'uv' // uv = audio verification required

export interface SalesCoachEvidence {
  // "Quote", "Offer quoted", "Leading question quoted", "Subsequent conduct", ...
  label: string
  text: string
}

export interface SalesCoachCriterion {
  key: string            // stable slug, e.g. 'sales_offer_buildup'
  label: string          // display, e.g. 'Sales Offer Build-up' (filled in code)
  verdict: SalesCoachVerdict
  // Short text shown next to the verdict mark, e.g. "Half page, USD 30,000" for
  // the OUTCOME criterion or "outcome is Positive/Won" for an N/A.
  note?: string
  evidence?: SalesCoachEvidence[]
  reason?: string
  scored: boolean        // counts toward the Execution Score (na/uv → false); filled in code
}

export interface SalesCoachObjection {
  objection: string              // the objection / hesitation, quoted
  handled: string                // how the representative actually handled it
  original_wording?: string      // what the rep said, verbatim
  trc_improved_response?: string // what TRC doctrine would have said
  principle?: string             // the relevant TRC principle
}

// A free-form "DEEPER ANALYSIS AND FEEDBACK" section beyond the objections,
// e.g. "CONCISE CONFIRMATION APPLICATION" or "RETORNO CONTROL".
export interface SalesCoachAnalysisSection {
  heading: string
  body: string
}

// The structured Report Card the model returns (validated + score recomputed
// in code, US-039). The markdown rendering in `report_card_markdown` is
// derived from this object by renderReportCardMarkdown(), never model-written.
export interface SalesCoachReportCard {
  company: string
  declared_outcome: SalesCoachOutcome | null
  assessed_position: SalesCoachAssessedPosition
  headline: string               // one line after the position + score
  execution_score: number        // half points allowed (pass 1 / warn 0.5 / fail 0)
  execution_denominator: number  // applicable (scored) criteria
  summary: string                // opening paragraph
  criteria: SalesCoachCriterion[]
  report_summary: string         // the SCORELINE "Report Summary"
  objections: SalesCoachObjection[]
  deeper_analysis: SalesCoachAnalysisSection[]
  discrepancy?: string | null
  management_review: boolean
  coaching_question: string
}

export interface SalesCoachNegotiation {
  id: string
  user_id: string | null
  submitted_by_name: string
  country: string | null
  media_publication: string | null
  company: string | null
  interviewee_name: string | null
  interviewee_position: string | null
  company_reps: SalesCoachParticipant[]
  trc_members: SalesCoachParticipant[]
  other_comments: string | null
  original_filename: string | null
  audio_path: string | null
  audio_mime: string | null
  transcribe_job_id: string | null
  uploaded_transcript: string | null
  system_transcript: string | null
  declared_outcome: SalesCoachOutcome | null
  outcome_details: Record<string, unknown>
  report_card: SalesCoachReportCard | null
  report_card_markdown: string | null
  ai_assessed_position: string | null
  execution_score: number | null
  execution_denominator: number | null
  uv_criteria: string[]
  discrepancy: string | null
  management_review: boolean
  project_prompt_snapshot: string | null
  knowledge_versions: Record<string, string> | null
  model_used: string | null
  actual_outcome: string | null
  actual_outcome_source: string | null
  actual_outcome_at: string | null
  stage: SalesCoachStage
  error: string | null
  tokens_input: number
  tokens_output: number
  tokens_total: number
  cost_usd: number
  created_at: string
  updated_at: string
}

export interface SalesCoachMessage {
  id: string
  negotiation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}
