import DocumentDetailView from '@/components/documents/DocumentDetailView'

interface Props {
  params: { id: string }
  searchParams: { generating?: string }
}

export default function EditorialBriefDetailPage({ params, searchParams }: Props) {
  return <DocumentDetailView docType="editorial_brief" id={params.id} generating={searchParams.generating} />
}
