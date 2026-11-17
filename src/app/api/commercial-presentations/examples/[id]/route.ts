import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminActor, requirePresentationActor } from '@/lib/commercial-presentations-server'

interface Params {
  params: { id: string }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const b = (await request.json().catch(() => ({}))) as { title?: string; projectType?: string; body?: string; active?: boolean }
  const patch: Record<string, unknown> = {}
  if (typeof b.title === 'string' && b.title.trim()) patch.title = b.title.trim().slice(0, 200)
  if (typeof b.projectType === 'string') patch.project_type = b.projectType.trim().slice(0, 120)
  if (typeof b.body === 'string' && b.body.trim()) patch.body = b.body.trim().slice(0, 20_000)
  if (typeof b.active === 'boolean') patch.active = b.active
  const { data, error } = await supabaseAdmin.from('presentation_reference_examples').update(patch).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ example: data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied
  const { error } = await supabaseAdmin.from('presentation_reference_examples').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
