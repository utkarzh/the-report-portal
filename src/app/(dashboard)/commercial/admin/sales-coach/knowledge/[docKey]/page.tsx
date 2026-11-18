export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireSalesCoachAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachAdminDocKey, SALES_COACH_ADMIN_DOCS, SALES_COACH_KNOWLEDGE_DOCS } from '@/lib/sales-coach'
import { LIVE_COACH_MASTER_BEHAVIOUR_PROMPT_V1 } from '@/lib/sales-coach-live-coach-prompt'
import { FOLLOW_UP_DECISION_PROMPT_V1 } from '@/lib/sales-coach-follow-up-prompt'
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
  const isFollowUpDecision = docKey === 'followup_decision'
  // The two documents with a built-in fallback (Rafa's own texts, word for word).
  const builtIn = isLiveCoach ? LIVE_COACH_MASTER_BEHAVIOUR_PROMPT_V1 : isFollowUpDecision ? FOLLOW_UP_DECISION_PROMPT_V1 : null

  const { data: row } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('content')
    .eq('doc_key', docKey)
    .maybeSingle()

  // An empty Live Coach or Follow-Up Decision Support document means the app
  // uses Rafa's built-in text, so the editor starts from exactly what is in use.
  const saved = (row?.content || '').trim()
  const usingDefault = builtIn !== null && (!saved || saved.toUpperCase().startsWith('PLACEHOLDER'))
  const initialContent = usingDefault && builtIn ? builtIn : row?.content || ''

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
            {isLiveCoach
              ? 'Live Coach · behaviour on live voice calls'
              : isFollowUpDecision
                ? 'Report Card · Follow-Up Decision Support'
                : `Authority order ${index + 1} of ${SALES_COACH_KNOWLEDGE_DOCS.length}`}
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
          {isFollowUpDecision && (
            <div className="mt-4 max-w-2xl border border-[#e5e3df] bg-[#faf9f7] px-4 py-3 text-xs leading-5 text-gray-600">
              <p>
                Writes the Report Card&apos;s Follow-Up Decision Support, word for word as saved here, in its own step after the
                Report Card, so it never changes a score. It draws on the playbook in the &ldquo;TRC Post-Meeting Follow-Up &amp;
                Conversion Playbook&rdquo; document and the other TRC documents. A change applies to recommendations written from then
                on; use Regenerate on a Report Card to see it there.
              </p>
              {usingDefault && (
                <p className="mt-2 font-medium text-gray-800">
                  Not saved yet: this is the 14 November 2026 Decision Support prompt the Report Card uses today. Save it to take control.
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
