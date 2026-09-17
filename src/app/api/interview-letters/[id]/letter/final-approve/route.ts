import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { ONE_PAGE_WORD_LIMIT, paragraphsToLetterText, wordCount } from '@/lib/interview-letters'
import type { InterviewLetterParagraph } from '@/types'

interface Params {
  params: { id: string }
}

// POST — US-055. No AI call: validates every variable paragraph is locked,
// the word-count/one-page heuristic, and required fields, then snapshots the
// master letter. This is the project's stable, immutable master from here on.
export async function POST(_request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single()

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('*')
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
  const unlocked = paragraphs.filter((p) => p.type === 'variable' && p.status !== 'locked')
  if (unlocked.length > 0) {
    return NextResponse.json(
      { error: `${unlocked.length} paragraph${unlocked.length === 1 ? '' : 's'} still need${unlocked.length === 1 ? 's' : ''} approval before you can finalize the letter.` },
      { status: 400 },
    )
  }
  if (!project.company || !project.project_country || !project.media_partner) {
    return NextResponse.json({ error: 'This project is missing required fields (company, country, or media partner).' }, { status: 400 })
  }

  const letterText = paragraphsToLetterText(paragraphs)
  const totalWords = wordCount(letterText)
  if (totalWords > ONE_PAGE_WORD_LIMIT) {
    return NextResponse.json(
      { error: `The letter is ${totalWords} words — over the ${ONE_PAGE_WORD_LIMIT}-word one-page limit. Trim a paragraph and try again.` },
      { status: 400 },
    )
  }

  const { error } = await supabaseAdmin
    .from('interview_letter_projects')
    .update({ master_letter: letterText, stage: 'letter_approved' })
    .eq('id', project.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, masterLetter: letterText })
}
