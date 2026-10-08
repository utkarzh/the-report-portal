import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbActor } from '@/lib/knowledge/access'
import { KNOWLEDGE_BUCKET } from '@/lib/knowledge/constants'

// GET — opens a suggestion's attached file: for its author, the Guardian of
// the department it was routed to, and platform admins.
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbActor()
  if (!actor) return response
  const { data: fb } = await supabaseAdmin
    .from('knowledge_feedback')
    .select('user_id, department_id, attachment_path, attachment_name')
    .eq('id', params.id)
    .maybeSingle()
  if (!fb?.attachment_path) return NextResponse.json({ error: 'No attachment' }, { status: 404 })

  let allowed = actor.role === 'admin' || fb.user_id === actor.id
  if (!allowed && fb.department_id) {
    const { data: dept } = await supabaseAdmin.from('knowledge_departments').select('guardian_id').eq('id', fb.department_id).maybeSingle()
    allowed = dept?.guardian_id === actor.id
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabaseAdmin.storage
    .from(KNOWLEDGE_BUCKET)
    .createSignedUrl(fb.attachment_path, 120, { download: fb.attachment_name || true })
  if (error || !data) return NextResponse.json({ error: 'Could not open the file.' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
