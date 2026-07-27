import DocumentListView from '@/components/documents/DocumentListView'

export default function BusinessCasesPage({ searchParams }: { searchParams: { page?: string } }) {
  return <DocumentListView docType="business_case" page={searchParams.page} />
}
