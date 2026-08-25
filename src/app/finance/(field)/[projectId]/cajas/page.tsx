import CajaListView from '@/components/finance/CajaListView'

export default function FieldCajasPage({ params }: { params: { projectId: string } }) {
  return <CajaListView projectId={params.projectId} backHref={`/finance/${params.projectId}`} />
}
