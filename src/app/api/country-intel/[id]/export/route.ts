import { NextRequest, NextResponse } from 'next/server'
import { requireCiAdmin } from '@/lib/country-intel/auth'
import { buildReportModel } from '@/lib/country-intel/report-data'
import { buildCiPdf } from '@/lib/country-intel/report-pdf'
import { buildCiWorkbook } from '@/lib/country-intel/report-xlsx'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

// GET /api/country-intel/[id]/export?format=pdf|xlsx
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireCiAdmin()
  if (!auth.userId) return auth.response
  const m = await buildReportModel(params.id)
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const format = request.nextUrl.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'pdf'
  const base = `${m.project.country} Country Intelligence Report — ${m.project.title}`.replace(/[\\/:*?"<>|]+/g, ' ').trim()
  if (format === 'xlsx') {
    const buf = await buildCiWorkbook(m)
    return new NextResponse(Buffer.from(buf as ArrayBuffer), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(base)}.xlsx` } })
  }
  const pdf = await buildCiPdf(m)
  return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(base)}.pdf` } })
}
