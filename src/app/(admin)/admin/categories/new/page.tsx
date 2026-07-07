import { requireAdminHeader } from '@/lib/auth/session'
import CategoryForm from '@/components/admin/CategoryForm'
import Breadcrumbs from '@/components/layout/Breadcrumbs'

export default function NewCategoryPage() {
  requireAdminHeader()

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8">
      <div className="max-w-5xl mx-auto">

        <Breadcrumbs
          items={[
            { label: 'Interview Tool', href: '/interview' },
            { label: 'Categories', href: '/admin/categories' },
            { label: 'New Category' },
          ]}
        />

        <div className="mb-8">
          <h1 className="text-lg font-semibold text-gray-900">New Category</h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
            Create a research template for a specific type of interviewee.
          </p>
        </div>

        <CategoryForm />

      </div>
    </div>
  )
}
