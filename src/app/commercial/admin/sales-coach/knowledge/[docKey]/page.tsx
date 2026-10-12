export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isSalesCoachKnowledgeKey, SALES_COACH_KNOWLEDGE_DOCS } from '@/lib/sales-coach'
import SalesCoachKnowledgeForm from '@/components/admin/SalesCoachKnowledgeForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Props {
  params: { docKey: string }
}

export default async function SalesCoachKnowledgePage({ params }: Props) {
  requireAdminHeader()

  if (!isSalesCoachKnowledgeKey(params.docKey)) notFound()
  const docKey = params.docKey
  const index = SALES_COACH_KNOWLEDGE_DOCS.findIndex((d) => d.key === docKey)
  const doc = SALES_COACH_KNOWLEDGE_DOCS[index]

  const { data: row } = await supabaseAdmin
    .from('sales_coach_knowledge')
    .select('content')
    .eq('doc_key', docKey)
    .maybeSingle()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Sales Coach', href: '/sales-coach' },
            { label: 'Admin', href: '/admin/sales-coach' },
            { label: doc.label },
          ]}
        />
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Authority order {index + 1} of {SALES_COACH_KNOWLEDGE_DOCS.length}
          </p>
          <h1 className="text-lg font-semibold text-gray-900 mt-1">{doc.label}</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">{doc.description} Every update is versioned with full rollback.</p>
        </div>

        <SalesCoachKnowledgeForm docKey={docKey} label={doc.label} initialContent={row?.content || ''} />
      </div>
    </div>
  )
}
