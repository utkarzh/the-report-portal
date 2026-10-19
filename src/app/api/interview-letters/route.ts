import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { cleanBriefText, isInterviewLetterCompany, isInterviewLetterVariant, matchBriefs } from '@/lib/interview-letters'
import { findMediaEntry } from '@/lib/media-library-server'
import type { InterviewLetterBriefOption } from '@/types'

// POST — US-050. Validates project setup, halts with zero API cost if no
// template exists for the selected company + letter version (mirrors
// meeting-prep's media-library halt at Step 1). No AI call in this route —
// the client fires research immediately after creation (US-051: no separate
// "start" action), which does its own token-reserve gate right before its
// own call.
//
// Also resolves the two pieces of reference content the rest of the run
// depends on, snapshotting both so later edits never change this project:
//   • the Editorial Brief used as research context — the one the user picked
//     (`editorialBriefId`), none (`null`), or, when the field is absent, the
//     closest country match;
//   • the central Media Library entry whose letter description is copied into
//     the letter word for word, matched by publication name.
export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, can_access_interview_letter_generator')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account inactive' }, { status: 403 })
  }
  if (profile.role !== 'admin' && !profile.can_access_interview_letter_generator) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const {
    company, projectCountry, mediaPartner, mediaPartnerCountry, hookInput,
    senderName, senderTitle, senderContact,
    letterVariant, anchor, publicationTiming, reportSector, editorialBriefId,
  } = body

  if (!isInterviewLetterCompany(company)) {
    return NextResponse.json({ error: 'A valid company (TRC or GFDI) is required' }, { status: 400 })
  }
  if (!isInterviewLetterVariant(letterVariant)) {
    return NextResponse.json({ error: 'Choose whether the report has an anchor' }, { status: 400 })
  }
  if (letterVariant === 'anchor' && !anchor?.trim()) {
    return NextResponse.json({ error: 'Describe the anchor — the event or publication occasion the report is tied to' }, { status: 400 })
  }
  if (!projectCountry?.trim() || !mediaPartner?.trim()) {
    return NextResponse.json({ error: 'Project country and media partner are required' }, { status: 400 })
  }
  if (!senderName?.trim() || !senderTitle?.trim()) {
    return NextResponse.json({ error: 'Sender name and title are required — this is who the cover email will be signed by' }, { status: 400 })
  }

  const { data: template } = await supabaseAdmin
    .from('interview_letter_templates')
    .select('id, structure')
    .eq('company', company)
    .eq('variant', letterVariant)
    .maybeSingle()

  if (!template || !Array.isArray(template.structure) || template.structure.length === 0) {
    return NextResponse.json(
      { error: `No ${letterVariant === 'anchor' ? '“with an anchor”' : '“without an anchor”'} letter template is configured for ${company} yet. Ask an admin to set one up before starting a project.` },
      { status: 422 },
    )
  }

  // Editorial Brief. Any complete brief may be used, whoever wrote it (the
  // setup form only ever shows brief titles).
  let brief: { id: string; title: string; output: string } | null = null
  if (typeof editorialBriefId === 'string' && editorialBriefId) {
    const { data } = await supabaseAdmin
      .from('document_sessions')
      .select('id, title, output, status, doc_type')
      .eq('id', editorialBriefId)
      .maybeSingle()
    if (!data || data.doc_type !== 'editorial_brief' || data.status !== 'complete' || !data.output) {
      return NextResponse.json({ error: 'That Editorial Brief is not available. Pick another one or start without a brief.' }, { status: 400 })
    }
    brief = { id: data.id, title: data.title, output: data.output }
  } else if (editorialBriefId === undefined) {
    const { data: candidates } = await supabaseAdmin
      .from('document_sessions')
      .select('id, title, project_country, media_partner, created_at')
      .eq('doc_type', 'editorial_brief')
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(300)
    const best = matchBriefs((candidates || []) as InterviewLetterBriefOption[], projectCountry)[0]
    if (best) {
      const { data } = await supabaseAdmin.from('document_sessions').select('id, title, output').eq('id', best.id).single()
      if (data?.output) brief = { id: data.id, title: data.title, output: data.output }
    }
  }

  // The central Media Library entry for the chosen publication (matched
  // ignoring case and spaces, like its unique index).
  const media = await findMediaEntry(mediaPartner)

  const { data: project, error } = await supabaseAdmin
    .from('interview_letter_projects')
    .insert({
      user_id: user.id,
      company,
      project_country: projectCountry.trim(),
      media_partner: media ? media.name : mediaPartner.trim(),
      media_partner_country: (mediaPartnerCountry || '').trim() || (media?.country || '').trim(),
      hook_input: (hookInput || '').trim(),
      sender_name: senderName.trim(),
      sender_title: senderTitle.trim(),
      sender_contact: (senderContact || '').trim(),
      letter_variant: letterVariant,
      anchor: letterVariant === 'anchor' ? anchor.trim() : '',
      publication_timing: (publicationTiming || '').trim(),
      report_sector: (reportSector || '').trim(),
      editorial_brief_id: brief?.id || null,
      editorial_brief_title: brief?.title || null,
      editorial_brief_snapshot: brief ? cleanBriefText(brief.output) : null,
      media_id: media?.id || null,
      media_description_snapshot: media?.letter_description?.trim() ? media.letter_description : null,
      stage: 'input',
    })
    .select('id')
    .single()

  if (error || !project) {
    return NextResponse.json({ error: error?.message || 'Failed to create project' }, { status: 500 })
  }

  return NextResponse.json({ id: project.id }, { status: 201 })
}
