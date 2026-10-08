import { redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import { accessibleDepartments, guardedDepartments, type KbActorRef } from '@/lib/knowledge/access'
import { knowledgeBaseInstalled } from '@/lib/knowledge/installed'
import type { KnowledgeDepartment } from '@/types'

// Common data for every Knowledge Base page. Middleware has already enforced
// sign-in, active status and the module flag; department access is read live.
export async function getKbPageContext(): Promise<{
  actor: KbActorRef & { full_name: string | null }
  isAdmin: boolean
  departments: KnowledgeDepartment[]
  guarded: KnowledgeDepartment[]
  showManage: boolean
}> {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')
  if (!(await knowledgeBaseInstalled())) redirect('/knowledge/setup')
  const actor = { id: profile.id, role: profile.role, full_name: profile.full_name }
  const [departments, guarded] = await Promise.all([accessibleDepartments(actor), guardedDepartments(actor)])
  const isAdmin = profile.role === 'admin'
  return { actor, isAdmin, departments, guarded, showManage: isAdmin || guarded.length > 0 }
}
