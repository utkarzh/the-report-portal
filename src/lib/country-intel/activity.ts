import type { CiProject } from './types'

// A run only advances while an open workspace page keeps calling
// /api/country-intel/[id]/step: there is no server-side scheduler (Vercel Hobby
// crons run daily). Every step stamps ci_projects.updated_at when it starts and
// when it ends, and no step can outlive Vercel's 300s cap, so a "running"
// project untouched for longer than this has no page driving it. It is paused
// in place and carries on as soon as someone opens it again.
export const NO_PAGE_AFTER_MS = 6 * 60_000

export function isWaitingForPage(p: Pick<CiProject, 'status' | 'updated_at'>, now = Date.now()): boolean {
  if (p.status !== 'running') return false
  const last = Date.parse(p.updated_at)
  return Number.isFinite(last) && now - last > NO_PAGE_AFTER_MS
}
