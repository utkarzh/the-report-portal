import { supabaseAdmin } from '@/lib/supabase/admin'
import { isMissingTable } from '@/lib/knowledge/schema-compat'

// Whether migration 034 has created the Knowledge Base tables on this
// database. A positive answer is remembered for the life of the server
// process (tables don't disappear); a negative one is re-checked every time,
// so the module lights up as soon as the migration is run — no restart.
let installed = false

export async function knowledgeBaseInstalled(): Promise<boolean> {
  if (installed) return true
  const { error } = await supabaseAdmin.from('knowledge_departments').select('id').limit(1)
  if (!error) {
    installed = true
    return true
  }
  // Only a genuinely missing table means "not installed" — a network blip
  // must not hide the module behind the setup screen.
  return !isMissingTable(error)
}
