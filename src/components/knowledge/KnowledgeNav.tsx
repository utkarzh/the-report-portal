import Link from 'next/link'
import { MessageCircleQuestion, LibraryBig, Lightbulb, ShieldCheck } from 'lucide-react'

export type KnowledgeTab = 'ask' | 'browse' | 'suggestions' | 'manage'

// Header + tab strip shared by every Knowledge Base page.
export default function KnowledgeNav({
  active,
  showManage,
  subtitle,
}: {
  active: KnowledgeTab
  showManage: boolean
  subtitle?: string
}) {
  const tabs: { key: KnowledgeTab; label: string; href: string; icon: React.ElementType }[] = [
    { key: 'ask', label: 'Ask', href: '/knowledge', icon: MessageCircleQuestion },
    { key: 'browse', label: 'Browse', href: '/knowledge/browse', icon: LibraryBig },
    { key: 'suggestions', label: 'My suggestions', href: '/knowledge/suggestions', icon: Lightbulb },
    ...(showManage ? [{ key: 'manage' as const, label: 'Manage', href: '/knowledge/manage', icon: ShieldCheck }] : []),
  ]
  return (
    <div className="mb-6">
      <h1 className="text-lg font-semibold text-gray-900">TRC Knowledge Base</h1>
      <p className="text-sm text-gray-500 mt-1.5 max-w-2xl">
        {subtitle ?? 'Ask how TRC does something and get answers from approved, published company knowledge.'}
      </p>
      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-[#e5e3df]">
        {tabs.map(({ key, label, href, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            className={`inline-flex items-center gap-2 whitespace-nowrap px-3.5 py-2.5 text-sm -mb-px border-b-2 transition-colors ${
              active === key
                ? 'border-black text-gray-900 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon size={15} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
