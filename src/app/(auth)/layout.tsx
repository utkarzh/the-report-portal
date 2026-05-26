export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0efec] flex flex-col">
      <header className="bg-black h-12 flex items-center px-6">
        <span className="text-white font-light tracking-[0.2em] text-sm uppercase">
          THE REPORT&nbsp;&nbsp;
        </span>
        <span className="text-white font-bold tracking-[0.2em] text-sm uppercase">
          EDITORIAL
        </span>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </div>
    </div>
  )
}
