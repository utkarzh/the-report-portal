import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminActor, requirePresentationActor } from '@/lib/commercial-presentations-server'

const MAX_BODY = 20_000

// GET — the Approved Reference Examples (admins).
export async function GET() {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const { data, error } = await supabaseAdmin.from('presentation_reference_examples').select('*').order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ examples: data || [] })
}

// POST { title, projectType, body, active? } — add an example. Examples are
// used for style, structure and reasoning only — never as facts (brief §13).
export async function POST(request: NextRequest) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const b = (await request.json().catch(() => ({}))) as { title?: string; projectType?: string; body?: string; active?: boolean }
  const title = (b.title || '').trim().slice(0, 200)
  const body = (b.body || '').trim().slice(0, MAX_BODY)
  if (!title || !body) return NextResponse.json({ error: 'Title and example text are required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('presentation_reference_examples')
    .insert({ title, project_type: (b.projectType || '').trim().slice(0, 120), body, active: b.active !== false, created_by: actor.id })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ example: data }, { status: 201 })
}
