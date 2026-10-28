import { NextRequest, NextResponse } from 'next/server'
import { requireFinanceAccess } from '@/lib/finance-auth'
import { marketRate } from '@/lib/fx-rates'

// GET /api/finance/fx-rate?base=USD&quote=JMD — today's market rate (quote
// units per 1 base unit) for the rate check next to every exchange-rate
// field (see components/finance/RateCheck.tsx). { rate: null } when no
// reference is available; the form then just shows the readback.
export async function GET(request: NextRequest) {
  const auth = await requireFinanceAccess()
  if ('error' in auth) return auth.error

  const base = request.nextUrl.searchParams.get('base') || ''
  const quote = request.nextUrl.searchParams.get('quote') || ''
  const market = await marketRate(base, quote)
  return NextResponse.json(market ?? { rate: null })
}
