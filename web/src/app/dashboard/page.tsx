'use client'

import { useEffect, useState } from 'react'
import { getStats, getApplications, type DashboardStats, type ApplicationRow } from '@/lib/api-client'

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [applications, setApplications] = useState<ApplicationRow[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [page, statusFilter])

  async function loadData() {
    try {
      setLoading(true)
      const [statsData, appsData] = await Promise.all([
        getStats(),
        getApplications(page, 20, statusFilter || undefined),
      ])
      setStats(statsData)
      setApplications(appsData.data)
      setTotal(appsData.total)
    } catch (err) {
      console.error('Failed to load dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  const statusColors: Record<string, string> = {
    submitted: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    manual_required: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  }

  const trackColors: Record<string, string> = {
    sniper: 'bg-brand-500/20 text-brand-400',
    shotgun: 'bg-surface-700/50 text-surface-300',
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Dashboard</span>
        </h1>
        <p className="text-surface-700 mt-1">Your automated job application pipeline at a glance.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Jobs Found Today"
          value={stats?.today.jobsFound ?? '—'}
          icon="🔍"
          gradient="from-blue-500/20 to-cyan-500/20"
        />
        <StatCard
          label="Applications Today"
          value={stats?.today.applications ?? '—'}
          icon="📨"
          gradient="from-emerald-500/20 to-green-500/20"
        />
        <StatCard
          label="Emails Sent Today"
          value={stats?.today.emailsSent ?? '—'}
          icon="✉️"
          gradient="from-purple-500/20 to-pink-500/20"
        />
        <StatCard
          label="Unresolved Failures"
          value={stats?.unresolvedFailures ?? '—'}
          icon="🚨"
          gradient={stats?.unresolvedFailures ? 'from-red-500/20 to-orange-500/20' : 'from-surface-800/20 to-surface-700/20'}
          alert={!!stats?.unresolvedFailures}
        />
      </div>

      {/* 30-Day Summary */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="glass-card p-5">
          <p className="text-xs text-surface-700 uppercase tracking-wider mb-1">30-Day Applications</p>
          <p className="text-2xl font-bold text-surface-50">{stats?.last30Days.applications ?? '—'}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-surface-700 uppercase tracking-wider mb-1">30-Day Emails Sent</p>
          <p className="text-2xl font-bold text-surface-50">{stats?.last30Days.emailsSent ?? '—'}</p>
        </div>
      </div>

      {/* Applications Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-5 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-surface-50">Applications</h2>
          <div className="flex gap-2">
            {['', 'submitted', 'failed', 'manual_required', 'pending'].map((s) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  statusFilter === s
                    ? 'bg-brand-600/30 text-brand-400'
                    : 'bg-white/5 text-surface-700 hover:bg-white/10'
                }`}
              >
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Company</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Role</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Track</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">ATS Status</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Score</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Applied At</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Resume</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-surface-700">
                    <div className="animate-pulse">Loading...</div>
                  </td>
                </tr>
              ) : applications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-surface-700">
                    No applications yet. The pipeline runs daily at 08:00 UTC.
                  </td>
                </tr>
              ) : (
                applications.map((app) => (
                  <tr key={app.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="p-4">
                      <span className="text-sm font-medium text-surface-50">{app.job_company}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-surface-300">{app.job_title}</span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${trackColors[app.track] || ''}`}>
                        {app.track === 'sniper' ? '🎯 Sniper' : '💨 Shotgun'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium border ${statusColors[app.ats_status] || 'bg-surface-800 text-surface-300'}`}>
                        {app.ats_status}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-surface-300">
                        {app.match_score ? `${Math.round(app.match_score)}%` : '—'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-surface-700">
                        {app.created_at ? new Date(app.created_at * 1000).toLocaleDateString() : '—'}
                      </span>
                    </td>
                    <td className="p-4">
                      {app.resume_url ? (
                        <a
                          href={app.resume_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-400 hover:text-brand-300 underline"
                        >
                          View PDF
                        </a>
                      ) : (
                        <span className="text-xs text-surface-800">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 20 && (
          <div className="p-4 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs text-surface-700">
              Page {page} of {Math.ceil(total / 20)}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs rounded-lg bg-white/5 text-surface-300 hover:bg-white/10 disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * 20 >= total}
                className="px-3 py-1.5 text-xs rounded-lg bg-white/5 text-surface-300 hover:bg-white/10 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label, value, icon, gradient, alert,
}: {
  label: string; value: number | string; icon: string; gradient: string; alert?: boolean
}) {
  return (
    <div className={`glass-card p-5 bg-gradient-to-br ${gradient} relative overflow-hidden group`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-surface-700 uppercase tracking-wider mb-1">{label}</p>
          <p className={`text-3xl font-bold ${alert ? 'text-red-400' : 'text-surface-50'}`}>{value}</p>
        </div>
        <span className="text-3xl opacity-60 group-hover:scale-110 transition-transform">{icon}</span>
      </div>
      {alert && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
    </div>
  )
}
