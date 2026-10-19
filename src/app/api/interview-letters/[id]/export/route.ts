import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildInterviewLetterDocx } from '@/lib/interview-letter-docx'
import { renderInterviewLetterPdf } from '@/lib/interview-letter-pdf'
import { attachmentDisposition, buildLetterLayout } from '@/lib/interview-letter-export'
import { letterDownloadName, type LetterRecipient } from '@/lib/interview-letters'
import { getTemplate, resolveTemplateForPartner } from '@/lib/download-templates/registry'
import { getApiUser } from '@/lib/auth/api-user'

// GET /api/interview-letters/[id]/export — US-059. Serves an approved letter
// as a real Word (.docx) or PDF file in the selected branded template (logo
// band, partner badge, footer address), laid out like the client's own
// letters — see buildLetterLayout. Owner or admin only; never changes
// approval state or calls an AI.
//
// What's exported:
//   • ?personalization=<id> — that recipient's personalized letter, with their
//     name/title/organisation in the header and the file name;
//   • otherwise the master letter, available from Final Approve onwards. The
//     optional recipientName / recipientTitle / recipientOrganisation params
//     fill the header and file name, and recipientName fills "Dear [Name],";
//     without them the header shows the highlighted "Name, Title, Company"
//     placeholder.
// For either, the signature's "Name" / "Position" lines are the project's
// sender (asked once, at project setup).
// File name: "Interview Request Letter – Name, Title, Company" (falls back to
// the project country for a master letter with no recipient).
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const user = auth.user

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: project } = await supabaseAdmin
    .from('interview_letter_projects')
    .select('id, user_id, company, project_country, media_partner, master_letter, sender_name, sender_title')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  let letterText: string | null = project.master_letter
  let recipient: LetterRecipient | null = {
    name: sp.get('recipientName'),
    title: sp.get('recipientTitle'),
    organisation: sp.get('recipientOrganisation'),
  }

  const personalizationId = sp.get('personalization')
  if (personalizationId) {
    const { data: p } = await supabaseAdmin
      .from('interview_letter_personalizations')
      .select('letter_text, recipient_name, recipient_title, recipient_organisation')
      .eq('id', personalizationId)
      .eq('project_id', project.id)
      .maybeSingle()
    if (!p) return NextResponse.json({ error: 'Personalized letter not found' }, { status: 404 })
    letterText = p.letter_text
    recipient = { name: p.recipient_name, title: p.recipient_title, organisation: p.recipient_organisation }
  }

  if (!letterText) {
    return NextResponse.json({ error: 'Letter not available yet' }, { status: 404 })
  }

  // `template` comes from DownloadTemplateModal when the user picked one;
  // falling back to a media_partner match keeps direct/bookmarked links
  // (no query params) branded correctly instead of defaulting blindly.
  const templateId = sp.get('template')
  const template = templateId ? getTemplate(templateId) : resolveTemplateForPartner(project.company, project.media_partner)
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'docx'

  const layout = buildLetterLayout({
    letterText,
    mediaPartner: project.media_partner,
    templatePartner: template.partner,
    recipient,
    signer: { name: project.sender_name, position: project.sender_title },
  })
  const base = letterDownloadName(project.project_country, recipient)

  if (format === 'pdf') {
    const buffer = await renderInterviewLetterPdf(layout, template)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(`${base}.pdf`),
        'Cache-Control': 'no-store',
      },
    })
  }

  const buffer = await Packer.toBuffer(buildInterviewLetterDocx(layout, template))
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': attachmentDisposition(`${base}.docx`),
      'Cache-Control': 'no-store',
    },
  })
}
