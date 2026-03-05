import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useClient } from '@/context/ClientContext'
import {
  getCallVolumeByDay,
  getClassificationBreakdown,
  getMissedCallsByDay,
  getRevenueByWeek,
  getTopServices,
} from '@/services/analytics.service'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { formatCurrency } from '@/lib/utils'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316']

const dateRangeOptions = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
]

export function AnalyticsPage() {
  const { clientId } = useClient()
  const [rangeDays, setRangeDays] = useState(30)

  const { dateFrom, dateTo } = useMemo(() => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - rangeDays)
    return {
      dateFrom: from.toISOString().split('T')[0],
      dateTo: to.toISOString().split('T')[0],
    }
  }, [rangeDays])

  const rangeParams = { clientId: clientId!, dateFrom, dateTo }

  const { data: callVolume } = useQuery({
    queryKey: ['callVolume', clientId, rangeDays],
    queryFn: () => getCallVolumeByDay(rangeParams),
    enabled: !!clientId,
  })

  const { data: classBreakdown } = useQuery({
    queryKey: ['classBreakdown', clientId, rangeDays],
    queryFn: () => getClassificationBreakdown(rangeParams),
    enabled: !!clientId,
  })

  const { data: missedCalls } = useQuery({
    queryKey: ['missedCalls', clientId, rangeDays],
    queryFn: () => getMissedCallsByDay(rangeParams),
    enabled: !!clientId,
  })

  const { data: revenue } = useQuery({
    queryKey: ['revenue', clientId, rangeDays],
    queryFn: () => getRevenueByWeek(rangeParams),
    enabled: !!clientId,
  })

  const { data: topServices } = useQuery({
    queryKey: ['topServices', clientId, rangeDays],
    queryFn: () => getTopServices(rangeParams),
    enabled: !!clientId,
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <div className="flex gap-2">
          {dateRangeOptions.map(opt => (
            <button
              key={opt.days}
              onClick={() => setRangeDays(opt.days)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                rangeDays === opt.days
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Call Volume */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Call Volume</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={callVolume?.data || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#3B82F6" strokeWidth={2} dot={false} name="Calls" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Classification Breakdown */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Call Types</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={classBreakdown?.data || []}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {(classBreakdown?.data || []).map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Missed Calls */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Missed Calls</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={missedCalls?.data || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#EF4444" strokeWidth={2} dot={false} name="Missed" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Revenue Impact</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={revenue?.data || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} name="Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Services */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 lg:col-span-2">
          <h2 className="font-semibold text-gray-900 mb-4">Top Services</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topServices?.data || []} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
              <Tooltip />
              <Bar dataKey="value" fill="#8B5CF6" radius={[0, 4, 4, 0]} name="Bookings" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
