import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { denyWithoutCopywritingAccess } from '@/lib/copywriting-access'
import { buildCopywritingDocx } from '@/lib/copywriting-docx'
import { renderCopywritingPdf } from '@/lib/copywriting-pdf'
import { loadExportImages } from '@/lib/copywriting-images'

interface Params {
  params: { id: string }
}

// GET /api/copywriting/[id]/export?format=docx|pdf — "Approve Final Version"
// output options (Comment 2, FLOW-12): Copy is handled client-side from the
// already-loaded final_output text; this route serves Word and PDF.
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  const denied = await denyWithoutCopywritingAccess(auth.user.id)
  if (denied) return denied

  const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', auth.user.id).single()
  const { data: project } = await supabaseAdmin
    .from('copywriting_projects')
    .select('id, user_id, draft_name, publication_name, article_type_name, final_output')
    .eq('id', params.id)
    .single()

  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.user_id !== auth.user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!project.final_output) return NextResponse.json({ error: 'Article not approved yet' }, { status: 409 })

  const format = request.nextUrl.searchParams.get('format') || 'docx'
  const base = project.draft_name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'article'
  // Photos uploaded into the article's [IMAGE n: …] slots, embedded in place.
  const images = await loadExportImages(project.id)

  if (format === 'pdf') {
    const buffer = await renderCopywritingPdf({
      draftName: project.draft_name,
      publicationName: project.publication_name,
      articleTypeName: project.article_type_name,
      finalText: project.final_output,
      images,
    })
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(base)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const doc = buildCopywritingDocx({
    draftName: project.draft_name,
    publicationName: project.publication_name,
    articleTypeName: project.article_type_name,
    finalText: project.final_output,
    images,
  })
  const buffer = await Packer.toBuffer(doc)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(base)}.docx"`,
      'Cache-Control': 'no-store',
    },
  })
}
