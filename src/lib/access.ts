import type { UserRole } from '@/types'

// The modules a normal user can be granted access to. Admins always have all.
export interface ModuleAccess {
  role: UserRole
  can_access_interview: boolean
  can_access_transcriptions: boolean
}

export function canAccessInterview(p: ModuleAccess): boolean {
  return p.role === 'admin' || p.can_access_interview
}

export function canAccessTranscriptions(p: ModuleAccess): boolean {
  return p.role === 'admin' || p.can_access_transcriptions
}

// Where a user should land after login / when they hit a page they can't see.
// Prefers the interview tool, falls back to transcriptions, else a no-access
// page. Never returns a path the user isn't allowed to view (avoids redirect
// loops in middleware).
export function landingPathFor(p: ModuleAccess): string {
  if (canAccessInterview(p)) return '/interview'
  if (canAccessTranscriptions(p)) return '/transcriptions'
  return '/no-access'
}
