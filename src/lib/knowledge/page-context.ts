import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { accessibleDepartments, guardedDepartments, type KbActorRef } from '@/lib/knowledge/access'
import { knowledgeBaseInstalled } from '@/lib/knowledge/installed'
import type { KnowledgeDepartment } from '@/types'

export interface KbPageContext {
  actor: KbActorRef & { full_name: string | null }
  isAdmin: boolean
  departments: KnowledgeDepartment[]
  guarded: KnowledgeDepartment[]
  showManage: boolean
  // Open feedback/suggestions waiting in the departments this person guards.
  reviewCount: number
}

// Common data for every Knowledge Base page. Middleware has already enforced
// sign-in, active status and the module flag; department access is read live.
export async function getKbPageContext(): Promise<KbPageContext> {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (!(await knowledgeBaseInstalled())) redirect('/knowledge/setup')
  const actor = { id: profile.id, role: profile.role, full_name: profile.full_name }
  const [departments, guarded] = await Promise.all([accessibleDepartments(actor), guardedDepartments(actor)])
  const isAdmin = profile.role === 'admin'
  let reviewCount = 0
  if (guarded.length) {
    const { count } = await supabaseAdmin
      .from('knowledge_feedback')
      .select('id', { count: 'exact', head: true })
      .in(
        'department_id',
        guarded.map((d) => d.id),
      )
      .eq('status', 'open')
    reviewCount = count ?? 0
  }
  return { actor, isAdmin, departments, guarded, showManage: isAdmin || guarded.length > 0, reviewCount }
}

// Guard for the module's admin area (/knowledge/admin/*). It lives inside the
// module rather than under /admin, so the middleware's /admin rule doesn't
// cover it: every admin page calls this first.
export async function requireKbAdmin() {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin') redirect('/knowledge')
  if (!(await knowledgeBaseInstalled())) redirect('/knowledge/setup')
  return profile
}
