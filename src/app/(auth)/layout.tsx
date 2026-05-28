import Image from 'next/image'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0efec] flex flex-col">
      <header className="bg-black h-16 flex items-center px-6">
        <Image
          src="/logo.png"
          alt="The Report Company"
          height={44}
          width={222}
          priority
          unoptimized
        />
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        {children}
      </div>
    </div>
  )
}
