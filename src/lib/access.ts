import type { UserRole, FinanceRole } from '@/types'

// The modules a normal user can be granted access to. Admins always have all.
export interface ModuleAccess {
  role: UserRole
  can_access_interview: boolean
  can_access_transcriptions: boolean
  can_access_business_cases: boolean
  can_access_editorial_briefs: boolean
  can_access_meeting_preparation: boolean
  can_access_interview_letter_generator: boolean
  finance_role: FinanceRole
}

export function canAccessInterview(p: ModuleAccess): boolean {
  return p.role === 'admin' || p.can_access_interview
}

export function canAccessTranscriptions(p: ModuleAccess): boolean {
  return p.role === 'admin' || p.can_access_transcriptions
}

export function canAccessBusinessCases(p: ModuleAccess): boolean {
  return p.role === 'admin' || p.can_access_business_cases
}

export function canAccessEditorialBriefs(p: ModuleAccess): boolean {
  return p.role === 'admin' || p.can_access_editorial_briefs
}

export function canAccessMeetingPreparation(
  p: Pick<ModuleAccess, 'role' | 'can_access_meeting_preparation'>,
): boolean {
  return p.role === 'admin' || p.can_access_meeting_preparation
}

export function canAccessInterviewLetterGenerator(
  p: Pick<ModuleAccess, 'role' | 'can_access_interview_letter_generator'>,
): boolean {
  return p.role === 'admin' || p.can_access_interview_letter_generator
}

// Cash Box (finance) module. Deliberately NOT folded into the editorial
// can_access_* flags above — see docs/cashbox-requirements.md Epic A and the
// note in migration 017. Platform admins ('admin') keep full, unrestricted
// access here too, same as every other module — the brief's domain-scoped
// super-admin/finance-admin split is a later change, not built yet.
export function canAccessFinance(p: Pick<ModuleAccess, 'role' | 'finance_role'>): boolean {
  return p.role === 'admin' || p.finance_role !== null
}

export function isFinanceAdmin(p: Pick<ModuleAccess, 'role' | 'finance_role'>): boolean {
  return p.role === 'admin' || p.finance_role === 'finance_admin'
}

// Where a user should land after login / when they hit a page they can't see.
// Prefers the interview tool, then transcriptions, then the document modules,
// then meeting preparation, then finance, else a no-access page. Never
// returns a path the user isn't allowed to view (avoids redirect loops in
// middleware).
export function landingPathFor(p: ModuleAccess): string {
  if (canAccessInterview(p)) return '/interview'
  if (canAccessTranscriptions(p)) return '/transcriptions'
  if (canAccessBusinessCases(p)) return '/business-cases'
  if (canAccessEditorialBriefs(p)) return '/editorial-briefs'
  if (canAccessMeetingPreparation(p)) return '/meeting-preparation'
  if (canAccessInterviewLetterGenerator(p)) return '/interview-letters'
  if (canAccessFinance(p)) return isFinanceAdmin(p) ? '/finance/admin' : '/finance'
  return '/no-access'
}
