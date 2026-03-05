import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useClient } from '@/context/ClientContext'
import { getInteractions, getTranscript } from '@/services/interactions.service'
import { useRealtime } from '@/hooks/useRealtime'
import { formatPhone, formatDuration, capitalize, cn } from '@/lib/utils'
import type { Interaction, Transcript } from '@/types/database'

const classificationColors: Record<string, string> = {
  booking: 'bg-green-100 text-green-700',
  emergency: 'bg-red-100 text-red-700',
  inquiry: 'bg-blue-100 text-blue-700',
  estimate: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-purple-100 text-purple-700',
}

const outcomeColors: Record<string, string> = {
  booked: 'bg-green-100 text-green-700',
  transferred: 'bg-blue-100 text-blue-700',
  voicemail: 'bg-gray-100 text-gray-600',
  resolved: 'bg-green-100 text-green-700',
}

const sentimentColors: Record<string, string> = {
  positive: 'text-green-600',
  neutral: 'text-gray-500',
  negative: 'text-red-600',
}

export function CallHistoryPage() {
  const { clientId } = useClient()
  const [page, setPage] = useState(0)
  const [classification, setClassification] = useState('all')
  const [outcome, setOutcome] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)

  useRealtime('interactions', ['interactions', clientId!])

  const { data, isLoading } = useQuery({
    queryKey: ['interactions', clientId, page, classification, outcome],
    queryFn: () => getInteractions({ clientId: clientId!, classification, outcome, page }),
    enabled: !!clientId,
  })

  async function toggleExpand(interaction: Interaction) {
    if (expandedId === interaction.id) {
      setExpandedId(null)
      setTranscript(null)
      return
    }
    setExpandedId(interaction.id)
    setTranscript(null)

    const { transcript: t } = await getTranscript(interaction.id)
    setTranscript(t)
  }

  const interactions = data?.interactions || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / 20)

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Call History</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={classification}
          onChange={e => { setClassification(e.target.value); setPage(0) }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="all">All types</option>
          <option value="booking">Booking</option>
          <option value="emergency">Emergency</option>
          <option value="inquiry">Inquiry</option>
          <option value="estimate">Estimate</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <select
          value={outcome}
          onChange={e => { setOutcome(e.target.value); setPage(0) }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value="all">All outcomes</option>
          <option value="booked">Booked</option>
          <option value="transferred">Transferred</option>
          <option value="voicemail">Voicemail</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Caller</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Outcome</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Duration</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Time</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500">Loading...</td></tr>
              ) : interactions.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500">No calls found</td></tr>
              ) : (
                interactions.map(interaction => (
                  <>
                    <tr key={interaction.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(interaction)}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{interaction.caller_name || formatPhone(interaction.caller_number)}</p>
                        {interaction.caller_name && (
                          <p className="text-xs text-gray-500">{formatPhone(interaction.caller_number)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {interaction.classification && (
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', classificationColors[interaction.classification])}>
                            {capitalize(interaction.classification)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {interaction.outcome && (
                          <span className={cn('text-xs px-2 py-0.5 rounded-full', outcomeColors[interaction.outcome])}>
                            {capitalize(interaction.outcome)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDuration(interaction.duration_seconds)}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatTime(interaction.created_at)}</td>
                      <td className="px-4 py-3">
                        <svg className={cn('w-4 h-4 text-gray-400 transition-transform', expandedId === interaction.id && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </td>
                    </tr>
                    {expandedId === interaction.id && (
                      <tr key={`${interaction.id}-detail`}>
                        <td colSpan={6} className="px-4 py-4 bg-gray-50">
                          {transcript ? (
                            <div className="space-y-3">
                              {transcript.sentiment && (
                                <p className="text-sm">
                                  Sentiment: <span className={cn('font-medium', sentimentColors[transcript.sentiment])}>{capitalize(transcript.sentiment)}</span>
                                </p>
                              )}
                              {transcript.summary && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Summary</p>
                                  <p className="text-sm text-gray-700">{transcript.summary}</p>
                                </div>
                              )}
                              {transcript.action_items && transcript.action_items.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase mb-1">Action Items</p>
                                  <ul className="text-sm text-gray-700 space-y-1">
                                    {transcript.action_items.map((item, i) => (
                                      <li key={i}>• {item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {transcript.full_text && (
                                <details className="mt-2">
                                  <summary className="text-xs font-medium text-gray-500 uppercase cursor-pointer hover:text-gray-700">Full Transcript</summary>
                                  <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap bg-white p-3 rounded border max-h-60 overflow-y-auto">
                                    {transcript.full_text}
                                  </pre>
                                </details>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500">Loading transcript...</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-500">{total} calls total</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50">Previous</button>
              <span className="px-3 py-1 text-sm text-gray-600">Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
