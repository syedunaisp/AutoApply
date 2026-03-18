'use client'

import { useEffect, useState } from 'react'
import { getScrapeRuns, type ScrapeRunRow } from '@/lib/api-client'

export default function LogsPage() {
  const [runs, setRuns] = useState<ScrapeRunRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRuns()
  }, [])

  async function loadRuns() {
    try {
      setLoading(true)
      const data = await getScrapeRuns(100)
      setRuns(data.data)
    } catch (err) {
      console.error('Failed to load scrape runs:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="gradient-text">Scrape Logs</span>
        </h1>
        <p className="text-surface-700 mt-1">History of all job scraping runs. Zero-result runs highlighted in red.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="glass-card p-5">
          <p className="text-xs text-surface-700 uppercase tracking-wider mb-1">Total Runs</p>
          <p className="text-2xl font-bold text-surface-50">{runs.length}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-surface-700 uppercase tracking-wider mb-1">Successful</p>
          <p className="text-2xl font-bold text-emerald-400">
            {runs.filter(r => r.status === 'success').length}
          </p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs text-surface-700 uppercase tracking-wider mb-1">Zero Results / Failed</p>
          <p className="text-2xl font-bold text-red-400">
            {runs.filter(r => r.status !== 'success').length}
          </p>
        </div>
      </div>

      {/* Runs Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-5 border-b border-white/5">
          <h2 className="text-lg font-semibold text-surface-50">Run History</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Keywords</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Location</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Source</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Results</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Status</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Duration</th>
                <th className="text-left p-4 text-xs text-surface-700 uppercase tracking-wider font-medium">Run At</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-surface-700">
                    <div className="animate-pulse">Loading...</div>
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-surface-700">
                    No scrape runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((run) => {
                  const isZero = run.result_count === 0 || run.status === 'zero_results'
                  const isFailed = run.status === 'failed'
                  const rowClass = isZero || isFailed
                    ? 'bg-red-500/5 border-l-2 border-l-red-500/50'
                    : ''

                  return (
                    <tr
                      key={run.id}
                      className={`border-b border-white/5 hover:bg-white/[0.02] transition-colors ${rowClass}`}
                    >
                      <td className="p-4 text-sm text-surface-50 font-medium">{run.search_keywords}</td>
                      <td className="p-4 text-sm text-surface-300">{run.search_location || '—'}</td>
                      <td className="p-4 text-sm text-surface-300">{run.source}</td>
                      <td className="p-4">
                        <span className={`text-sm font-semibold ${isZero ? 'text-red-400' : 'text-emerald-400'}`}>
                          {run.result_count}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                          run.status === 'success'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : run.status === 'zero_results'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-red-500/20 text-red-400'
                        }`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-surface-700">
                        {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                      </td>
                      <td className="p-4 text-xs text-surface-700">
                        {run.run_at ? new Date(run.run_at * 1000).toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Error messages */}
        {runs.some(r => r.error_message) && (
          <div className="p-5 border-t border-white/5">
            <h3 className="text-sm font-medium text-red-400 mb-2">Recent Errors</h3>
            {runs.filter(r => r.error_message).slice(0, 5).map(r => (
              <div key={r.id} className="text-xs text-surface-700 bg-red-500/5 p-3 rounded-lg mb-2">
                <span className="text-red-400">{r.search_keywords}:</span> {r.error_message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
