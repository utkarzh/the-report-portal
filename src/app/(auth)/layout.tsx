export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen min-h-dvh bg-[#f0efec] flex items-center justify-center px-4 py-6 sm:py-12">
      {children}
    </div>
  )
}
