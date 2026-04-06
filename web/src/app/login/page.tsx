'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const correct = process.env.NEXT_PUBLIC_DASHBOARD_PASSWORD
    if (password === correct) {
      localStorage.setItem('autoapply_auth', 'true')
      router.push('/dashboard')
    } else {
      setError(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0b0f]">
      <div className="glass-card p-8 w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-bold gradient-text mb-1">AutoApply</h1>
          <p className="text-surface-700 text-sm">Enter your password to access the dashboard.</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(false) }}
              placeholder="Password"
              autoFocus
              className="w-full bg-[#0a0b0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500 transition-colors"
            />
            {error && <p className="text-red-400 text-xs mt-1.5">Incorrect password.</p>}
          </div>
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-brand-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
