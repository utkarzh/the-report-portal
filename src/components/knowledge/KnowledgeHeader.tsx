import Link from 'next/link'
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  LibraryBig,
  Lightbulb,
  MessageCircleQuestion,
  MessagesSquare,
  ShieldCheck,
  UsersRound,
} from 'lucide-react'
import type { KbPageContext } from '@/lib/knowledge/page-context'

export type KnowledgeTab = 'ask' | 'browse' | 'suggestions' | 'manage'

const MAX_SCOPE_CHIPS = 2

// Module header shared by every Knowledge Base page: title, the departments
// this person's answers draw on, the admin tools strip (admins, like every
// other module) and the tab strip.
export default function KnowledgeHeader({
  ctx,
  active,
  adminBar = true,
  subtitle,
}: {
  ctx: KbPageContext
  active: KnowledgeTab
  // Top-level pages show the admin strip; deeper pages (an item, the editor)
  // leave it out to keep the content close to the top.
  adminBar?: boolean
  subtitle?: string
}) {
  const tabs: { key: KnowledgeTab; label: string; href: string; icon: React.ElementType; badge?: number }[] = [
    { key: 'ask', label: 'Ask', href: '/knowledge', icon: MessageCircleQuestion },
    { key: 'browse', label: 'Browse', href: '/knowledge/browse', icon: LibraryBig },
    { key: 'suggestions', label: 'My suggestions', href: '/knowledge/suggestions', icon: Lightbulb },
    ...(ctx.showManage ? [{ key: 'manage' as const, label: 'Manage', href: '/knowledge/manage', icon: ShieldCheck, badge: ctx.reviewCount }] : []),
  ]
  const shown = ctx.departments.slice(0, MAX_SCOPE_CHIPS)
  const extra = ctx.departments.length - shown.length

  return (
    <header className="mb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#e5e3df] bg-[#f7f6f3] p-2.5 text-gray-700">
            <BookOpen size={18} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900">TRC Knowledge Base</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              {subtitle ?? 'Ask how TRC does something and get answers from approved, published company knowledge — with the sources to prove it.'}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
          {ctx.departments.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              <AlertTriangle size={11} /> Not in a department yet
            </span>
          ) : ctx.isAdmin ? (
            // Admins see every department — a count reads better than a row of chips.
            <span
              title={ctx.departments.map((d) => d.name).join(', ')}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e3df] bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#c8973f]" />
              Answers draw on all {ctx.departments.length} departments
            </span>
          ) : (
            <>
              <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {ctx.departments.length === 1 ? 'Your department' : 'Your departments'}
              </span>
              {shown.map((d) => (
                <span
                  key={d.id}
                  className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-[#e5e3df] bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700"
                >
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#c8973f]" />
                  <span className="truncate">{d.name}</span>
                </span>
              ))}
              {extra > 0 && (
                <span
                  title={ctx.departments.slice(MAX_SCOPE_CHIPS).map((d) => d.name).join(', ')}
                  className="rounded-full border border-[#e5e3df] bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500"
                >
                  +{extra}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {ctx.isAdmin && adminBar && <KnowledgeAdminBar />}

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-[#e5e3df]">
        {tabs.map(({ key, label, href, icon: Icon, badge }) => (
          <Link
            key={key}
            href={href}
            className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors ${
              active === key ? 'border-black font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Icon size={15} />
            {label}
            {!!badge && badge > 0 && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold tabular-nums text-amber-800">
                {badge}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </header>
  )
}

// The same gold "Admin tools" strip every other module shows its admins.
function KnowledgeAdminBar() {
  return (
    <div className="mt-5 rounded-xl border border-[#c8973f]/25 bg-[#fbf7ed] p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex-shrink-0 rounded-lg bg-[#c8973f]/10 p-2 text-[#a07530]">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a07530]">Admin tools</p>
            <p className="mt-0.5 text-sm text-gray-600">Departments, Guardians and members — plus the full log of questions asked.</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <AdminLink href="/knowledge/admin" icon={<UsersRound size={14} className="text-[#a07530]" />} label="Departments & access" />
          <AdminLink href="/knowledge/admin/chats" icon={<MessagesSquare size={14} className="text-[#a07530]" />} label="Chat log" />
          <AdminLink href="/admin/analytics" icon={<BarChart3 size={14} className="text-[#a07530]" />} label="Usage & cost" />
        </div>
      </div>
    </div>
  )
}

function AdminLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 rounded-lg border border-[#c8973f]/25 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8973f]/50 hover:text-[#a07530] hover:shadow"
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}
