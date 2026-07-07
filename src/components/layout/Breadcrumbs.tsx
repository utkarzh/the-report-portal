import Link from 'next/link'
import { ChevronRight, ArrowLeft } from 'lucide-react'

export interface Crumb {
  label: string
  href?: string
}

/**
 * Breadcrumb trail for pages that live *inside* a module (e.g. the Categories and
 * Prompts admin pages belong to the Interview Tool). Renders a "back one level"
 * arrow plus a clickable trail. The last crumb is the current page (not a link).
 *
 * The back arrow targets the nearest ancestor that has an href — i.e. one level
 * up. For a top-level module page like `Interview Tool / Categories` that means
 * the arrow returns to the Interview Tool.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const parentHref = [...items.slice(0, -1)].reverse().find((c) => c.href)?.href

  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-3">
      {parentHref && (
        <Link
          href={parentHref}
          className="flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={15} />
        </Link>
      )}
      <ol className="flex items-center gap-1.5 flex-wrap text-xs">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link href={item.href} className="text-gray-400 hover:text-gray-700 transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? 'text-gray-700 font-medium' : 'text-gray-400'}>
                  {item.label}
                </span>
              )}
              {!isLast && <ChevronRight size={12} className="text-gray-300 flex-shrink-0" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
