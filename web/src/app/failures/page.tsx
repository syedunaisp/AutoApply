'use client'

import { useEffect, useState } from 'react'
import { getFailures, resolveFailure, type FailureRow } from '@/lib/api-client'

export default function FailuresPage() {
  const [failures, setFailures] = useState<FailureRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showResolved, setShowResolved] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [resolveNote, setResolveNote] = useState('')

  useEffect(() => {
    loadFailures()
  }, [showResolved])

  async function loadFailures() {
    try {
      setLoading(true)
      const data = await getFailures(1, 100, showResolved ? undefined : false)
      setFailures(data.data)
    } catch (err) {
      console.error('Failed to load failures:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve(id: string) {
    try {
      await resolveFailure(id, resolveNote)
      setResolveNote('')
      await loadFailures()
    } catch (err) {
      console.error('Failed to resolve:', err)
    }
  }

  const entityTypeColors: Record<string, string> = {
    scrape: 'bg-blue-500/20 text-blue-400',
    match: 'bg-cyan-500/20 text-cyan-400',
    application: 'bg-purple-500/20 text-purple-400',
    email: 'bg-pink-500/20 text-pink-400',
    apollo: 'bg-amber-500/20 text-amber-400',
    zerobounce: 'bg-orange-500/20 text-orange-400',
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="gradient-text">Failures</span>
          </h1>
          <p className="text-surface-700 mt-1">Dead-letter queue — every failed action with full error payload.</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-surface-700">Show resolved</span>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="w-4 h-4 rounded bg-surface-800 border-surface-700 text-brand-600 focus:ring-brand-500"
          />
        </label>
      </div>

      {/* Summary */}
      <div className="glass-card p-5 mb-6 flex items-center gap-6">
        <div>
          <span className="text-xs text-surface-700">Unresolved</span>
          <p className="text-xl font-bold text-red-400">{failures.filter(f => !f.resolved).length}</p>
        </div>
        <div className="w-px h-8 bg-white/10" />
        <div>
          <span className="text-xs text-surface-700">Total Shown</span>
          <p className="text-xl font-bold text-surface-50">{failures.length}</p>
        </div>
      </div>

      {/* Failures List */}
      <div className="space-y-3">
        {loading ? (
          <div className="glass-card p-8 text-center text-surface-700 animate-pulse">Loading...</div>
        ) : failures.length === 0 ? (
          <div className="glass-card p-8 text-center text-surface-700">
            🎉 No unresolved failures. The pipeline is healthy.
          </div>
        ) : (
          failures.map((failure) => {
            const isExpanded = expandedId === failure.id
            return (
              <div
                key={failure.id}
                className={`glass-card overflow-hidden transition-all duration-200 ${
                  failure.resolved ? 'opacity-60' : ''
                }`}
              >
                {/* Summary Row */}
                <div
                  className="p-5 flex items-center gap-4 cursor-pointer hover:bg-white/[0.02]"
                  onClick={() => setExpandedId(isExpanded ? null : failure.id)}
                >
                  <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                    entityTypeColors[failure.entity_type] || 'bg-surface-800 text-surface-300'
                  }`}>
                    {failure.entity_type}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-50 font-medium truncate">
                      {failure.error_code && <span className="text-red-400 mr-2">[{failure.error_code}]</span>}
                      {failure.error_message}
                    </p>
                    <p className="text-xs text-surface-700 mt-0.5">
                      {failure.created_at ? new Date(failure.created_at * 1000).toLocaleString() : '—'}
                      {failure.retry_count > 0 && ` • ${failure.retry_count} retries`}
                    </p>
                  </div>

                  {failure.resolved ? (
                    <span className="px-2.5 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-400">
                      Resolved
                    </span>
                  ) : (
                    <span className="text-xs text-surface-700">▼</span>
                  )}
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-white/5 pt-4 space-y-4">
                    {/* Error Details */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-surface-700">Entity Type</span>
                        <p className="text-surface-300">{failure.entity_type}</p>
                      </div>
                      <div>
                        <span className="text-xs text-surface-700">Entity ID</span>
                        <p className="text-surface-300 font-mono text-xs">{failure.entity_id || '—'}</p>
                      </div>
                      <div>
                        <span className="text-xs text-surface-700">User ID</span>
                        <p className="text-surface-300 font-mono text-xs">{failure.user_id || '—'}</p>
                      </div>
                      <div>
                        <span className="text-xs text-surface-700">Error Code</span>
                        <p className="text-red-400 font-mono text-xs">{failure.error_code || '—'}</p>
                      </div>
                    </div>

                    {/* Raw Payload */}
                    {failure.raw_payload && (
                      <div>
                        <span className="text-xs text-surface-700 mb-1 block">Raw Payload</span>
                        <pre className="bg-[#0a0b0f] border border-white/5 rounded-lg p-4 text-xs text-surface-300 overflow-x-auto max-h-60 overflow-y-auto font-mono">
                          {formatPayload(failure.raw_payload)}
                        </pre>
                      </div>
                    )}

                    {/* Resolved Note */}
                    {failure.resolved_note && (
                      <div>
                        <span className="text-xs text-surface-700">Resolution Note</span>
                        <p className="text-emerald-400 text-sm">{failure.resolved_note}</p>
                      </div>
                    )}

                    {/* Resolve Action */}
                    {!failure.resolved && (
                      <div className="flex gap-3">
                        <input
                          type="text"
                          placeholder="Resolution note (optional)..."
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                          className="flex-1 bg-[#0a0b0f] border border-white/10 rounded-lg px-4 py-2 text-sm text-surface-50 placeholder-surface-800 focus:outline-none focus:border-brand-500"
                        />
                        <button
                          onClick={() => handleResolve(failure.id)}
                          className="px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-600/30 transition-colors border border-emerald-500/20"
                        >
                          Mark Resolved
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function formatPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
