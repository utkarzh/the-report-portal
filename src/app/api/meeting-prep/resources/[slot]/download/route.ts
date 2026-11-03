import { NextRequest, NextResponse } from 'next/server'
import { isResourceSlot } from '@/lib/meeting-prep'
import { getResourceFile, requireMeetingPrepCaller, signResourcePath } from '@/lib/meeting-prep-server'

// GET /api/meeting-prep/resources/[slot]/download — anyone with Meeting Prep
// access: 302 to a short-lived signed URL that downloads the slot's file
// under its original name (the planteo's "download a sample apertura
// letter HERE" links in the aperturador script, also in the exported .docx).
export async function GET(_request: NextRequest, { params }: { params: { slot: string } }) {
  const caller = await requireMeetingPrepCaller()
  if ('response' in caller) return caller.response
  if (!isResourceSlot(params.slot)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const file = await getResourceFile(params.slot)
  if (!file) {
    return NextResponse.json({ error: 'No sample file has been uploaded yet. Ask an admin to add one under Meeting Preparation → Admin → Apertura sample files.' }, { status: 404 })
  }
  const url = await signResourcePath(file.path, { downloadName: file.name, seconds: 60 })
  if (!url) return NextResponse.json({ error: 'Could not prepare the download' }, { status: 500 })
  return NextResponse.redirect(url, 302)
}
