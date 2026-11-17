import { NextRequest, NextResponse } from 'next/server'
import { Packer } from 'docx'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { attachmentDisposition } from '@/lib/interview-letter-export'
import { presentationFileBase } from '@/lib/commercial-presentations'
import { buildExportModel } from '@/lib/commercial-presentation-export'
import { buildPresentationDocx } from '@/lib/commercial-presentation-docx'
import { renderPresentationPdf } from '@/lib/commercial-presentation-pdf'
import { loadPresentationBundle, profileNames, requirePresentationActor } from '@/lib/commercial-presentations-server'
import type { PresentationSnapshot } from '@/types'

export const maxDuration = 60

interface Params {
  params: { id: string }
}

// GET ?format=docx|pdf&which=approved|draft&snapshot=<id>
//   which=approved (default when one exists) — the exact approved snapshot,
//     never re-rendered, so later Master Content edits can't change it;
//   which=draft — the live rendering, marked "DRAFT — not approved";
//   snapshot=<id> — a specific earlier approved version.
// No AI call; never changes state.
export async function GET(request: NextRequest, { params }: Params) {
  const { actor, response } = await requirePresentationActor()
  if (!actor) return response
  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) return NextResponse.json({ error: 'Presentation not found' }, { status: 404 })
  const { presentation, project } = bundle

  const sp = request.nextUrl.searchParams
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'docx'
  const snapshotId = sp.get('snapshot') || (sp.get('which') === 'draft' ? null : presentation.approved_snapshot_id)

  let snapshot: PresentationSnapshot | null = null
  if (snapshotId) {
    const { data } = await supabaseAdmin
      .from('presentation_snapshots')
      .select('*')
      .eq('id', snapshotId)
      .eq('presentation_id', presentation.id)
      .maybeSingle()
    if (!data) return NextResponse.json({ error: 'Approved version not found' }, { status: 404 })
    snapshot = data as PresentationSnapshot
  }

  const approvedBy = snapshot?.approved_by ? (await profileNames([snapshot.approved_by])).get(snapshot.approved_by) || null : null
  const ps = snapshot?.project_snapshot || {}
  const model = buildExportModel({
    projectName: ps.name || project.name,
    agency: ps.agency || project.agency_name,
    media: ps.media || project.media_name,
    mediaMarket: ps.mediaMarket ?? bundle.mediaMarket,
    country: ps.country || project.country,
    blocks: snapshot ? snapshot.blocks : bundle.rendered.blocks,
    approved: snapshot ? { versionNumber: snapshot.version_number, approvedAt: snapshot.approved_at, approvedBy } : null,
    factsForReview: bundle.selectedVersion?.new_external_facts ?? [],
  })

  const base = `${presentationFileBase(project)}${snapshot ? ` v${snapshot.version_number}` : ' (DRAFT)'}`
  if (format === 'pdf') {
    const buffer = await renderPresentationPdf(model)
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(`${base}.pdf`),
        'Cache-Control': 'no-store',
      },
    })
  }
  const buffer = await Packer.toBuffer(buildPresentationDocx(model))
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': attachmentDisposition(`${base}.docx`),
      'Cache-Control': 'no-store',
    },
  })
}
