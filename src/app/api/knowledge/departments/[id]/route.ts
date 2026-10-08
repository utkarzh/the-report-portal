import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbAdmin, validateGuardian } from '@/lib/knowledge/access'

// PATCH /api/knowledge/departments/[id] — rename, describe, change Guardian,
// archive/unarchive (US-098). Changing the Guardian needs no data migration:
// drafts and open feedback are routed by department, so they move to the new
// Guardian automatically. Archiving keeps every item; it just takes the
// department out of browsing and answers until it's unarchived.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { actor, response } = await getKbAdmin()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as {
    name?: string
    description?: string
    guardianId?: string | null
    archived?: boolean
  }
  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'Name can’t be empty.' }, { status: 400 })
    updates.name = name
  }
  if (body.description !== undefined) updates.description = body.description.trim()
  if (body.guardianId !== undefined) {
    if (body.guardianId) {
      const problem = await validateGuardian(body.guardianId)
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    }
    updates.guardian_id = body.guardianId || null
  }
  if (body.archived !== undefined) updates.archived_at = body.archived ? new Date().toISOString() : null
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('knowledge_departments')
    .update(updates)
    .eq('id', params.id)
    .select('*')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Department not found' }, { status: 404 })
  return NextResponse.json({ department: data })
}
