import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { profileNames, requireAdminActor, requirePresentationActor } from '@/lib/commercial-presentations-server'

interface Params {
  params: { contentId: string }
}

// GET — earlier versions of one piece of master content, newest first.
export async function GET(_req: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const denied = requireAdminActor(actor)
  if (denied) return denied

  const { data, error } = await supabaseAdmin
    .from('presentation_master_versions')
    .select('*')
    .eq('content_id', params.contentId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const names = await profileNames((data || []).map((v) => v.saved_by))
  return NextResponse.json({
    versions: (data || []).map((v) => ({ ...v, saved_by_name: v.saved_by ? names.get(v.saved_by) || null : null })),
  })
}
