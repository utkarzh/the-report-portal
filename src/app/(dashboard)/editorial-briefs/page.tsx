import DocumentListView from '@/components/documents/DocumentListView'

export default function EditorialBriefsPage({ searchParams }: { searchParams: { page?: string } }) {
  return <DocumentListView docType="editorial_brief" page={searchParams.page} />
}
