import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getApiUser } from '@/lib/auth/api-user'
import { canDownloadPatternPdf } from '@/lib/sales-coach-admins'
import { PATTERN_ROW_COLUMNS, computePatternStats, toPatternSummary, type PatternNegotiationRow, type PatternStats } from '@/lib/sales-coach-patterns'
import { PATTERN_TABLE } from '@/lib/sales-coach-patterns-server'
import { buildPatternPdf, patternPdfName } from '@/lib/sales-coach-patterns-pdf'
import { attachmentDisposition } from '@/lib/interview-letter-export'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

// GET /api/sales-coach/patterns/[analysisId]/pdf — one saved pattern analysis
// as the PDF report. Only the accounts in SALES_COACH_PATTERN_PDF_EMAILS.
// Built from the saved row (its stats and text) plus the Report Cards it read,
// so it matches the analysis exactly and needs no AI call.
export async function GET(_request: NextRequest, { params }: { params: { analysisId: string } }) {
  const auth = await getApiUser()
  if (!auth.user) return auth.response
  if (!canDownloadPatternPdf(auth.user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(params.analysisId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: analysis, error } = await supabaseAdmin
    .from(PATTERN_TABLE)
    .select('id, subject_name, scope, card_count, negotiation_ids, period_start, period_end, stats, output, created_at')
    .eq('id', params.analysisId)
    .maybeSingle()
  if (error || !analysis) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ids = (analysis.negotiation_ids || []) as string[]
  const { data: rows, error: rowsError } = ids.length
    ? await supabaseAdmin.from('sales_coach_negotiations').select(PATTERN_ROW_COLUMNS).in('id', ids)
    : { data: [], error: null }
  if (rowsError) {
    console.error('Sales coach patterns PDF: card load failed', rowsError.message)
    return NextResponse.json({ error: 'Could not load the Report Cards.' }, { status: 500 })
  }
  const cards = ((rows || []) as unknown as PatternNegotiationRow[])
    .filter((r) => r.report_card)
    .map(toPatternSummary)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  try {
    const pdf = await buildPatternPdf({
      subjectName: analysis.subject_name || 'Sales Executive',
      scope: analysis.scope,
      cardCount: analysis.card_count,
      periodStart: analysis.period_start,
      periodEnd: analysis.period_end,
      analysedAt: analysis.created_at,
      // The stats stored with the analysis are what the AI was given.
      stats: (analysis.stats as PatternStats | null) ?? computePatternStats(cards),
      cards,
      output: analysis.output || '',
    })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(`${patternPdfName(analysis.subject_name || 'Sales Executive', analysis.created_at)}.pdf`),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('Sales coach patterns PDF: render failed', err)
    return NextResponse.json({ error: 'Could not build the PDF.' }, { status: 500 })
  }
}
