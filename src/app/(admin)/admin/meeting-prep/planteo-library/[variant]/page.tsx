export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requireAdminHeader } from '@/lib/auth/session'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { isInterviewType, INTERVIEW_TYPES } from '@/lib/meeting-prep'
import PlanteoLibraryForm from '@/components/admin/PlanteoLibraryForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

interface Props {
  params: { variant: string }
}

export default async function PlanteoLibraryVariantPage({ params }: Props) {
  requireAdminHeader()

  if (!isInterviewType(params.variant)) notFound()
  const variant = params.variant
  const label = INTERVIEW_TYPES.find(t => t.value === variant)?.label ?? variant

  const { data: row } = await supabaseAdmin
    .from('meeting_prep_planteo_library')
    .select('template_text')
    .eq('variant', variant)
    .maybeSingle()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Meeting Preparation', href: '/meeting-preparation' },
            { label: 'Admin', href: '/admin/meeting-prep' },
            { label: 'Planteo Library' },
          ]}
        />
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">{label} Planteo Formula</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            The approved TRC planteo build-up script for this variant (Appendix A). The AI may not deviate
            from this structure.
          </p>
        </div>

        <PlanteoLibraryForm
          variant={variant}
          label={label}
          initialTemplateText={row?.template_text || ''}
        />
      </div>
    </div>
  )
}
