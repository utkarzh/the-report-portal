import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import type { InterviewLetterParagraph } from '@/types'

interface Params {
  params: { id: string }
}

// POST — no AI call, the reverse of .../letter/approve: puts one approved
// variable paragraph back to pending so it can be regenerated and approved
// again. Added with step navigation (19 Oct 2026): before it, an approved
// paragraph could never be changed on its project. The master letter is
// only re-snapshotted by the next Final Approve.
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()

  const { key } = await request.json()
  if (typeof key !== 'string' || !key) {
    return NextResponse.json({ error: 'A paragraph key is required' }, { status: 400 })
  }

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, user_id, stage, paragraphs')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (project.stage !== 'letter_review') {
    return NextResponse.json({ error: 'This project is not at the letter review stage.' }, { status: 409 })
  }

  const paragraphs = (project.paragraphs || []) as InterviewLetterParagraph[]
  const target = paragraphs.find((p) => p.key === key)
  if (!target || target.type !== 'variable') {
    return NextResponse.json({ error: 'Invalid paragraph key' }, { status: 400 })
  }

  const updatedParagraphs = paragraphs.map((p) => (p.key === key ? { ...p, status: 'pending' as const } : p))

  const { error } = await supabaseAdmin
    .from('interview_letter_projects')
    .update({ paragraphs: updatedParagraphs })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, paragraphs: updatedParagraphs })
}
