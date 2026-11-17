export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getProfileFromHeaders } from '@/lib/auth/session'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import PresentationWorkspace from '@/components/commercial-presentations/PresentationWorkspace'
import { MODULE_PATH } from '@/lib/commercial-presentations'
import { actorFromHeaderProfile, loadPresentationBundle } from '@/lib/commercial-presentations-server'
import { buildWorkspaceState } from '@/lib/commercial-presentations-state'

export default async function CommercialPresentationPage({ params }: { params: { id: string } }) {
  const profile = getProfileFromHeaders()
  if (!profile) redirect('/login')

  const bundle = await loadPresentationBundle(params.id)
  if (!bundle) notFound()
  const state = await buildWorkspaceState(bundle, actorFromHeaderProfile(profile))

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-5xl">
        <Breadcrumbs items={[{ label: 'Commercial Presentations', href: MODULE_PATH }, { label: bundle.project.name }]} />
        <PresentationWorkspace initial={state} currentUserName={profile.full_name || ''} />
      </div>
    </div>
  )
}
