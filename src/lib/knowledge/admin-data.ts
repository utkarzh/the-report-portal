import { supabaseAdmin } from '@/lib/supabase/admin'
import { displayName } from '@/lib/knowledge/access'
import type { UserOption } from '@/components/knowledge/admin/DepartmentFormModal'

// Active accounts, for Guardian / member pickers.
export async function loadUserOptions(): Promise<UserOption[]> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'active')
    .order('full_name')
  return (data || []).map((u) => ({ value: u.id, label: `${displayName(u)}${u.full_name ? ` (${u.email})` : ''}` }))
}

// US-122: what the admin must be warned about for a department's Guardian.
export function guardianWarningFor(guardian: { status: string } | null, hasGuardianId: boolean): string | null {
  if (!hasGuardianId) return 'No Guardian assigned — this department is read-only. Its published knowledge stays live, but nothing can be published or reviewed until you assign one.'
  if (guardian && guardian.status !== 'active') {
    return 'This department’s Guardian is deactivated — nobody can publish or review here until you assign a new Guardian. Published knowledge stays live.'
  }
  return null
}
