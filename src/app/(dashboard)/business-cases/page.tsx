import DocumentListView from '@/components/documents/DocumentListView'

export default function BusinessCasesPage({ searchParams }: { searchParams: { page?: string; search?: string } }) {
  return <DocumentListView docType="business_case" page={searchParams.page} search={searchParams.search} />
}
