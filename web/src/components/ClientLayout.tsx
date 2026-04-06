'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/login') {
      setChecked(true)
      return
    }
    const authed = localStorage.getItem('autoapply_auth') === 'true'
    if (!authed) {
      router.push('/login')
    } else {
      setChecked(true)
    }
  }, [pathname, router])

  // Don't render until auth check completes — prevents flash of content
  if (!checked) return null

  // Login page: full screen, no sidebar
  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-64 p-8">
        <div className="page-enter max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
