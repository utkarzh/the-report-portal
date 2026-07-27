import DocumentDetailView from '@/components/documents/DocumentDetailView'

interface Props {
  params: { id: string }
  searchParams: { generating?: string }
}

export default function BusinessCaseDetailPage({ params, searchParams }: Props) {
  return <DocumentDetailView docType="business_case" id={params.id} generating={searchParams.generating} />
}
