'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
  { href: '/logs', label: 'Scrape Logs', icon: '📋' },
  { href: '/failures', label: 'Failures', icon: '🚨' },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-[#0d0e14] border-r border-white/5 flex flex-col z-50">
      {/* Logo */}
      <div className="p-6 border-b border-white/5">
        <h1 className="text-xl font-bold">
          <span className="gradient-text">Auto</span>
          <span className="text-surface-50">Apply</span>
        </h1>
        <p className="text-xs text-surface-700 mt-1">Automated Job Applications</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium
                transition-all duration-200 group
                ${isActive
                  ? 'bg-brand-600/20 text-brand-400 shadow-lg shadow-brand-600/10'
                  : 'text-surface-700 hover:text-surface-50 hover:bg-white/5'
                }
              `}
            >
              <span className="text-lg group-hover:scale-110 transition-transform">{item.icon}</span>
              {item.label}
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Status footer */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-2 text-xs text-surface-700">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>System Active</span>
        </div>
        <p className="text-[10px] text-surface-800 mt-1">Next cron: 08:00 UTC</p>
      </div>
    </aside>
  )
}
