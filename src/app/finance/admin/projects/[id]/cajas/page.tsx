import CajaListView from '@/components/finance/CajaListView'

export default function AdminCajasPage({ params }: { params: { id: string } }) {
  return <CajaListView projectId={params.id} backHref={`/finance/admin/projects/${params.id}`} />
}
