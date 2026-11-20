import { redirect } from 'next/navigation'

// Items are managed in place now: the department's content list opens the
// item's row (?item=). Kept so old links and bookmarks still land there.
export default function KnowledgeItemEditorRedirect({ params }: { params: { deptId: string; itemId: string } }) {
  redirect(`/knowledge/manage/${params.deptId}?item=${params.itemId}`)
}
