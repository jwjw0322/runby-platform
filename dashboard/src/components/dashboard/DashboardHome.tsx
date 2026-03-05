import { useQuery } from '@tanstack/react-query'
import { useClient } from '@/context/ClientContext'
import { getDashboardStats } from '@/services/analytics.service'
import { getRecentInteractions } from '@/services/interactions.service'
import { getUpcomingBookings } from '@/services/bookings.service'
import { useRealtime } from '@/hooks/useRealtime'
import { StatsCard } from './StatsCard'
import { formatCurrency, formatDuration, formatPhone, capitalize } from '@/lib/utils'
import type { Interaction, Booking } from '@/types/database'

const classificationColors: Record<string, string> = {
  booking: 'bg-green-100 text-green-700',
  emergency: 'bg-red-100 text-red-700',
  inquiry: 'bg-blue-100 text-blue-700',
  estimate: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-purple-100 text-purple-700',
}

const statusColors: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-gray-100 text-gray-700',
}

export function DashboardHome() {
  const { clientId, client } = useClient()

  useRealtime('interactions', ['stats', clientId!])
  useRealtime('bookings', ['upcomingBookings', clientId!])

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats', clientId],
    queryFn: () => getDashboardStats(clientId!),
    enabled: !!clientId,
    refetchInterval: 60000,
  })

  const { data: recentData } = useQuery({
    queryKey: ['recentInteractions', clientId],
    queryFn: () => getRecentInteractions(clientId!, 10),
    enabled: !!clientId,
  })

  const { data: bookingsData } = useQuery({
    queryKey: ['upcomingBookings', clientId],
    queryFn: () => getUpcomingBookings(clientId!, 5),
    enabled: !!clientId,
  })

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {client ? `${client.business_name} Dashboard` : 'Dashboard'}
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          label="Today's Calls"
          value={statsLoading ? '...' : stats?.todayCalls || 0}
          icon="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
          color="blue"
        />
        <StatsCard
          label="Today's Bookings"
          value={statsLoading ? '...' : stats?.todayBookings || 0}
          icon="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          color="green"
        />
        <StatsCard
          label="Missed Calls"
          value={statsLoading ? '...' : stats?.todayMissedCalls || 0}
          icon="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
          color="red"
        />
        <StatsCard
          label="Revenue Impact"
          value={statsLoading ? '...' : formatCurrency(stats?.todayRevenue || 0)}
          icon="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          color="yellow"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent activity */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Calls</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {(recentData?.interactions || []).length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">No calls yet today</p>
            ) : (
              (recentData?.interactions || []).map((interaction: Interaction) => (
                <div key={interaction.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {interaction.caller_name || formatPhone(interaction.caller_number)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatTime(interaction.created_at)}
                      {interaction.duration_seconds ? ` · ${formatDuration(interaction.duration_seconds)}` : ''}
                    </p>
                  </div>
                  {interaction.classification && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${classificationColors[interaction.classification] || 'bg-gray-100 text-gray-600'}`}>
                      {capitalize(interaction.classification)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Upcoming bookings */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Upcoming Bookings</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {(bookingsData?.bookings || []).length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">No upcoming bookings</p>
            ) : (
              (bookingsData?.bookings || []).map((booking: Booking) => (
                <div key={booking.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {booking.customer_name || 'Unknown'} — {booking.service_type || 'Service'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {booking.scheduled_date} at {booking.scheduled_time}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[booking.status] || 'bg-gray-100 text-gray-600'}`}>
                    {capitalize(booking.status)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
