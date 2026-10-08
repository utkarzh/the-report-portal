import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canAccessKnowledgeBase } from '@/lib/access'
import { isMissingKbColumn, KB_NOT_INSTALLED_MESSAGE } from '@/lib/knowledge/schema-compat'
import type { KnowledgeDepartment, KnowledgeItem, UserRole } from '@/types'

// The department permission boundary for the Knowledge Base, in ONE place.
//
// Every check here reads membership/guardianship live from the database — no
// cache — so removing someone from a department applies on their very next
// request (US-099) and a deactivated account is refused straight away
// (US-121). API routes resolve the caller with getKbActor(); server components
// pass the middleware-verified { id, role } from getProfileFromHeaders().

export interface KbActor {
  id: string
  role: UserRole
  full_name: string | null
  email: string
  tokens_used: number
  token_limit: number | null
}

export type KbActorRef = Pick<KbActor, 'id' | 'role'>

export async function getKbActor(): Promise<{ actor: KbActor; response?: undefined } | { actor: null; response: NextResponse }> {
  const auth = await getApiUser()
  if (!auth.user) return { actor: null, response: auth.response }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, full_name, email, tokens_used, token_limit, can_access_knowledge_base')
    .eq('id', auth.user.id)
    .maybeSingle()

  if (isMissingKbColumn(error)) {
    return { actor: null, response: NextResponse.json({ error: KB_NOT_INSTALLED_MESSAGE, setupRequired: true }, { status: 503 }) }
  }

  if (!profile || profile.status !== 'active') {
    return { actor: null, response: NextResponse.json({ error: 'Account inactive' }, { status: 403 }) }
  }
  if (!canAccessKnowledgeBase({ role: profile.role, can_access_knowledge_base: profile.can_access_knowledge_base ?? false })) {
    return {
      actor: null,
      response: NextResponse.json({ error: 'You don’t have access to the Knowledge Base' }, { status: 403 }),
    }
  }
  return {
    actor: {
      id: profile.id,
      role: profile.role,
      full_name: profile.full_name,
      email: profile.email,
      tokens_used: profile.tokens_used ?? 0,
      token_limit: profile.token_limit,
    },
  }
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 })
}

// Departments whose published knowledge this person may browse and the AI may
// use for them: admins → every live department; everyone else → the ones they
// are a member of plus the ones they guard. Archived departments never count.
export async function accessibleDepartmentIds(actor: KbActorRef): Promise<string[]> {
  if (actor.role === 'admin') {
    const { data } = await supabaseAdmin.from('knowledge_departments').select('id').is('archived_at', null)
    return (data || []).map((d) => d.id)
  }
  const [{ data: memberships }, { data: guarded }] = await Promise.all([
    supabaseAdmin.from('knowledge_department_members').select('department_id').eq('user_id', actor.id),
    supabaseAdmin.from('knowledge_departments').select('id').eq('guardian_id', actor.id),
  ])
  const ids = new Set<string>([
    ...(memberships || []).map((m) => m.department_id as string),
    ...(guarded || []).map((d) => d.id as string),
  ])
  if (ids.size === 0) return []
  const { data: live } = await supabaseAdmin
    .from('knowledge_departments')
    .select('id')
    .in('id', Array.from(ids))
    .is('archived_at', null)
  return (live || []).map((d) => d.id)
}

export async function accessibleDepartments(actor: KbActorRef): Promise<KnowledgeDepartment[]> {
  const ids = await accessibleDepartmentIds(actor)
  if (ids.length === 0) return []
  const { data } = await supabaseAdmin.from('knowledge_departments').select('*').in('id', ids).order('name')
  return (data || []) as KnowledgeDepartment[]
}

// Live departments this person is the Guardian of.
export async function guardedDepartments(actor: KbActorRef): Promise<KnowledgeDepartment[]> {
  const { data } = await supabaseAdmin
    .from('knowledge_departments')
    .select('*')
    .eq('guardian_id', actor.id)
    .is('archived_at', null)
    .order('name')
  return (data || []) as KnowledgeDepartment[]
}

export async function canViewDepartment(actor: KbActorRef, departmentId: string): Promise<boolean> {
  const ids = await accessibleDepartmentIds(actor)
  return ids.includes(departmentId)
}

// Management view of a department: its Guardian may edit; a platform admin may
// look (read-only — admins never publish department knowledge, US-098).
export async function departmentForManagement(
  actor: KbActorRef,
  departmentId: string,
): Promise<{ department: KnowledgeDepartment; canEdit: boolean } | null> {
  const { data } = await supabaseAdmin.from('knowledge_departments').select('*').eq('id', departmentId).maybeSingle()
  if (!data) return null
  const department = data as KnowledgeDepartment
  const isGuardian = department.guardian_id === actor.id
  if (!isGuardian && actor.role !== 'admin') return null
  return { department, canEdit: isGuardian && !department.archived_at }
}

// Guardian-only write gate for a department. Only the department's current
// Guardian can create, edit, publish or archive its knowledge (US-105); with
// no Guardian assigned the department is read-only for everyone (US-122).
export async function requireGuardian(
  actor: KbActorRef,
  departmentId: string,
): Promise<{ department: KnowledgeDepartment; response?: undefined } | { department: null; response: NextResponse }> {
  const { data } = await supabaseAdmin.from('knowledge_departments').select('*').eq('id', departmentId).maybeSingle()
  if (!data) return { department: null, response: NextResponse.json({ error: 'Department not found' }, { status: 404 }) }
  const department = data as KnowledgeDepartment
  if (department.archived_at) {
    return { department: null, response: forbidden('This department is archived and read-only.') }
  }
  if (department.guardian_id !== actor.id) {
    return { department: null, response: forbidden('Only this department’s Guardian can change its knowledge.') }
  }
  return { department }
}

export async function requireGuardianForItem(
  actor: KbActorRef,
  itemId: string,
): Promise<
  | { item: KnowledgeItem; department: KnowledgeDepartment; response?: undefined }
  | { item: null; department: null; response: NextResponse }
> {
  const { data } = await supabaseAdmin.from('knowledge_items').select('*').eq('id', itemId).maybeSingle()
  if (!data) return { item: null, department: null, response: NextResponse.json({ error: 'Item not found' }, { status: 404 }) }
  const item = data as KnowledgeItem
  const g = await requireGuardian(actor, item.department_id)
  if (!g.department) return { item: null, department: null, response: g.response }
  return { item, department: g.department }
}

export function displayName(p: { full_name: string | null; email?: string | null } | null | undefined): string | null {
  if (!p) return null
  return p.full_name?.trim() || p.email || null
}

export async function getKbAdmin(): Promise<{ actor: KbActor; response?: undefined } | { actor: null; response: NextResponse }> {
  const res = await getKbActor()
  if (!res.actor) return res
  if (res.actor.role !== 'admin') return { actor: null, response: forbidden() }
  return res
}

// A Guardian needs the module itself to do the job, so assigning one grants
// the Knowledge Base flag too (admins already have every module).
export async function validateGuardian(guardianId: string): Promise<string | null> {
  const { data: g } = await supabaseAdmin
    .from('profiles')
    .select('id, status, role, can_access_knowledge_base')
    .eq('id', guardianId)
    .maybeSingle()
  if (!g) return 'That Guardian account no longer exists.'
  if (g.status !== 'active') return 'That account is deactivated — choose an active user as Guardian.'
  if (g.role !== 'admin' && !g.can_access_knowledge_base) {
    await supabaseAdmin.from('profiles').update({ can_access_knowledge_base: true }).eq('id', guardianId)
  }
  return null
}
