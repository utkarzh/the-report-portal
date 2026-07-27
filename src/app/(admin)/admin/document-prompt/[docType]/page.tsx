export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader, getProfileFromHeaders } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getDocConfig, isDocType } from '@/lib/documents'
import DocumentPromptForm from '@/components/admin/DocumentPromptForm'
import DocumentSamplesManager from '@/components/documents/DocumentSamplesManager'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Params {
  params: { docType: string }
}

export default async function DocumentPromptPage({ params }: Params) {
  requireAdminHeader()

  if (!isDocType(params.docType)) notFound()
  const docType = params.docType
  const config = getDocConfig(docType)
  const profile = getProfileFromHeaders()
  if (!profile) notFound()

  const [{ data: promptRow }, { data: sampleRows }] = await Promise.all([
    supabaseAdmin.from('document_prompt').select('prompt_text').eq('doc_type', docType).maybeSingle(),
    supabaseAdmin
      .from('document_samples')
      .select('id, filename, size_bytes, char_count, truncated, created_at')
      .eq('doc_type', docType)
      .order('created_at', { ascending: false }),
  ])

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: config.labelPlural, href: `/${config.slug}` },
            { label: 'Prompt & Samples' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{config.label} Prompt & Samples</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The prompt below is the highest-priority instruction for every {config.label.toLowerCase()} generation. The sample documents shape the output&apos;s structure, depth, and tone.
          </p>
        </div>

        <div className="flex flex-col gap-8">
          <DocumentPromptForm
            docType={docType}
            label={config.label}
            initialPrompt={promptRow?.prompt_text || ''}
          />

          <DocumentSamplesManager
            docType={docType}
            label={config.label}
            userId={profile.id}
            initialSamples={sampleRows || []}
          />
        </div>
      </div>
    </div>
  )
}
