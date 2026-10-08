import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getKbAdmin, validateGuardian } from '@/lib/knowledge/access'

// POST /api/knowledge/departments — admin creates a department (US-098).
export async function POST(request: NextRequest) {
  const { actor, response } = await getKbAdmin()
  if (!actor) return response

  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string; guardianId?: string | null }
  const name = (body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Give the department a name.' }, { status: 400 })
  if (name.length > 120) return NextResponse.json({ error: 'Name is too long.' }, { status: 400 })

  const guardianId = body.guardianId || null
  if (guardianId) {
    const problem = await validateGuardian(guardianId)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('knowledge_departments')
    .insert({ name, description: (body.description || '').trim(), guardian_id: guardianId, created_by: actor.id })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ department: data })
}
