import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useClient } from '@/context/ClientContext'
import { getAlerts, getUnreadAlertCount, markAlertRead, markAllAlertsRead } from '@/services/alerts.service'
import { useRealtime } from '@/hooks/useRealtime'
import { cn } from '@/lib/utils'
import type { Alert } from '@/types/database'

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
}

const typeLabels: Record<string, string> = {
  emergency: 'Emergency',
  negative_review: 'Negative Review',
  failed_transfer: 'Failed Transfer',
  high_value_lead: 'High-Value Lead',
}

export function AlertsBell() {
  const { clientId } = useClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const alertsQueryKey = ['alerts', clientId]
  useRealtime('alerts', alertsQueryKey)

  const { data: countData } = useQuery({
    queryKey: ['alertCount', clientId],
    queryFn: () => getUnreadAlertCount(clientId!),
    enabled: !!clientId,
    refetchInterval: 30000,
  })

  const { data: alertsData } = useQuery({
    queryKey: alertsQueryKey,
    queryFn: () => getAlerts(clientId!, true, 10),
    enabled: !!clientId && open,
  })

  const markReadMutation = useMutation({
    mutationFn: markAlertRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertCount', clientId] })
      queryClient.invalidateQueries({ queryKey: alertsQueryKey })
    },
  })

  const markAllMutation = useMutation({
    mutationFn: () => markAllAlertsRead(clientId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertCount', clientId] })
      queryClient.invalidateQueries({ queryKey: alertsQueryKey })
    },
  })

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const unreadCount = countData?.count || 0
  const alerts = alertsData?.alerts || []

  function formatTime(dateStr: string) {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 rounded-md hover:bg-gray-100">
        <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-medium">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-sm">Alerts</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                className="text-xs text-brand-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No unread alerts</p>
            ) : (
              alerts.map((alert: Alert) => (
                <div
                  key={alert.id}
                  className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  onClick={() => markReadMutation.mutate(alert.id)}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded border', severityColors[alert.severity])}>
                      {typeLabels[alert.type] || alert.type}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto">{formatTime(alert.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1">{alert.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
