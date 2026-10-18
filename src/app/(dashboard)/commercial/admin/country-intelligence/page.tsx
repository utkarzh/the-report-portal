import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdminHeader } from '@/lib/auth/session'
import CiPromptEditor from '@/components/country-intel/CiPromptEditor'

export default function CountryIntelAdminPage() {
  requireAdminHeader()
  return (
    <div className="p-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/commercial/country-intelligence" className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-black"><ArrowLeft size={14} /> Country Intelligence</Link>
        <h1 className="text-base font-semibold text-gray-900">Country Intelligence — system prompt</h1>
        <p className="mt-1 mb-5 text-sm text-gray-500">The research rules every run follows. Each run adds its own project brief (country, theme, sectors, revenue threshold, ownership rule) after this text, and the criteria are also enforced in code. Saving keeps the previous version in the history below.</p>
        <CiPromptEditor />
      </div>
    </div>
  )
}
