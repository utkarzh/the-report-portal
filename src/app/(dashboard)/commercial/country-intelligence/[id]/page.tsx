export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { summarize } from '@/lib/country-intel/engine'
import ResearchWorkspace from '@/components/country-intel/ResearchWorkspace'
import type { CiProject } from '@/lib/country-intel/types'

export default async function CountryIntelProjectPage({ params, searchParams }: { params: { id: string }; searchParams: { run?: string } }) {
  const { data } = await supabaseAdmin.from('ci_projects').select('*').eq('id', params.id).maybeSingle()
  if (!data) notFound()
  const summary = await summarize(params.id)
  return (
    <div className="p-8">
      <ResearchWorkspace initialProject={data as CiProject} initialSummary={summary} autoRun={searchParams.run === '1'} />
    </div>
  )
}
