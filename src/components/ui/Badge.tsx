interface BadgeProps {
  variant: 'active' | 'inactive' | 'admin' | 'user' | 'pending'
  children: React.ReactNode
}

const styles = {
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  inactive: 'bg-gray-100 text-gray-500 border border-gray-200',
  admin: 'bg-black text-white',
  user: 'bg-gray-100 text-gray-600 border border-gray-200',
  pending: 'bg-amber-50 text-amber-700 border border-amber-200',
}

export default function Badge({ variant, children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wider ${styles[variant]}`}>
      {children}
    </span>
  )
}
