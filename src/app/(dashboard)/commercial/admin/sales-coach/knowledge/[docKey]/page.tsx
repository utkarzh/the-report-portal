export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireSalesCoachAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachAdminDocKey, SALES_COACH_ADMIN_DOCS, SALES_COACH_KNOWLEDGE_DOCS } from '@/lib/sales-coach'
import { LIVE_COACH_MASTER_BEHAVIOUR_PROMPT_V1 } from '@/lib/sales-coach-live-coach-prompt'
import SalesCoachKnowledgeForm from '@/components/admin/SalesCoachKnowledgeForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Props {
  params: { docKey: string }
}

export default async function SalesCoachKnowledgePage({ params }: Props) {
  requireSalesCoachAdminHeader()

  if (!isSalesCoachAdminDocKey(params.docKey)) notFound()
  const docKey = params.docKey
  const doc = SALES_COACH_ADMIN_DOCS.find((d) => d.key === docKey)!
  const index = SALES_COACH_KNOWLEDGE_DOCS.findIndex((d) => d.key === docKey)
  const isLiveCoach = docKey === 'live_coach'

  const { data: row } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('content')
    .eq('doc_key', docKey)
    .maybeSingle()

  // An empty Live Coach document means calls use Rafa's Master Behaviour Prompt
  // v1.0 (the built-in fallback), so the editor starts from exactly what calls
  // are using now.
  const saved = (row?.content || '').trim()
  const usingDefault = isLiveCoach && (!saved || saved.toUpperCase().startsWith('PLACEHOLDER'))
  const initialContent = usingDefault ? LIVE_COACH_MASTER_BEHAVIOUR_PROMPT_V1 : row?.content || ''

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/commercial/sales-coach' },
            { label: 'Admin', href: '/commercial/admin/sales-coach' },
            { label: doc.label },
          ]}
        />
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            {isLiveCoach ? 'Live Coach · behaviour on live voice calls' : `Authority order ${index + 1} of ${SALES_COACH_KNOWLEDGE_DOCS.length}`}
          </p>
          <h1 className="text-lg font-semibold text-gray-900 mt-1">{doc.label}</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">{doc.description} Every update is versioned with full rollback.</p>
          {isLiveCoach && (
            <div className="mt-4 max-w-2xl border border-[#e5e3df] bg-[#faf9f7] px-4 py-3 text-xs leading-5 text-gray-600">
              <p>
                Placed at the very end of every live call&apos;s instructions, word for word, after the five knowledge documents, the
                Report Card, the transcript and the chat so far. The coach is told it governs how it behaves on the call and wins over
                the app&apos;s general coaching persona. Used only on live calls, never for Report Cards or the text coach. A change
                applies to the next call that starts; a call already running keeps the text it started with.
              </p>
              {usingDefault && (
                <p className="mt-2 font-medium text-gray-800">
                  Not saved yet: this is the Master Behaviour Prompt v1.0 the Live Coach falls back to. Save it to take control.
                </p>
              )}
            </div>
          )}
        </div>

        <SalesCoachKnowledgeForm docKey={docKey} label={doc.label} initialContent={initialContent} />
      </div>
    </div>
  )
}
