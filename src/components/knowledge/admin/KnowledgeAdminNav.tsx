import Link from 'next/link'
import { BarChart3, MessagesSquare, UsersRound } from 'lucide-react'

// Tab strip shared by the Knowledge Base admin pages.
export default function KnowledgeAdminNav({ active }: { active: 'departments' | 'chats' }) {
  const tabs = [
    { key: 'departments', label: 'Departments & access', href: '/knowledge/admin', icon: UsersRound },
    { key: 'chats', label: 'Chat log', href: '/knowledge/admin/chats', icon: MessagesSquare },
  ] as const
  return (
    <nav className="mb-6 flex items-center gap-1 overflow-x-auto border-b border-[#e5e3df]">
      {tabs.map(({ key, label, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
            active === key ? 'border-black font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Icon size={15} />
          {label}
        </Link>
      ))}
      <Link href="/admin/analytics" className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-900">
        <BarChart3 size={13} /> Usage &amp; cost in Analytics
      </Link>
    </nav>
  )
}
