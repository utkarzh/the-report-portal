import type { UserRole } from '@/types'

// The modules a normal user can be granted access to. Admins always have all.
export interface ModuleAccess {
  role: UserRole
  can_access_interview: boolean
  can_access_transcriptions: boolean
  can_access_business_cases: boolean
  can_access_editorial_briefs: boolean
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

// Where a user should land after login / when they hit a page they can't see.
// Prefers the interview tool, then transcriptions, then the two document
// modules, else a no-access page. Never returns a path the user isn't allowed
// to view (avoids redirect loops in middleware).
export function landingPathFor(p: ModuleAccess): string {
  if (canAccessInterview(p)) return '/interview'
  if (canAccessTranscriptions(p)) return '/transcriptions'
  if (canAccessBusinessCases(p)) return '/business-cases'
  if (canAccessEditorialBriefs(p)) return '/editorial-briefs'
  return '/no-access'
}
