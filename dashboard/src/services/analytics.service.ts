import { supabase } from '@/config/supabase'

interface DateRange {
  clientId: string
  dateFrom: string
  dateTo: string
}

export async function getCallVolumeByDay({ clientId, dateFrom, dateTo }: DateRange) {
  const { data, error } = await supabase
    .from('interactions')
    .select('created_at')
    .eq('client_id', clientId)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59')
    .order('created_at', { ascending: true })

  if (error) return { data: [], error }

  // Group by date
  const grouped: Record<string, number> = {}
  for (const row of data || []) {
    const date = row.created_at.split('T')[0]
    grouped[date] = (grouped[date] || 0) + 1
  }

  const result = Object.entries(grouped).map(([date, count]) => ({ date, count }))
  return { data: result, error: null }
}

export async function getClassificationBreakdown({ clientId, dateFrom, dateTo }: DateRange) {
  const { data, error } = await supabase
    .from('interactions')
    .select('classification')
    .eq('client_id', clientId)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59')

  if (error) return { data: [], error }

  const grouped: Record<string, number> = {}
  for (const row of data || []) {
    const key = row.classification || 'other'
    grouped[key] = (grouped[key] || 0) + 1
  }

  const result = Object.entries(grouped).map(([name, value]) => ({ name, value }))
  return { data: result, error: null }
}

export async function getMissedCallsByDay({ clientId, dateFrom, dateTo }: DateRange) {
  const { data, error } = await supabase
    .from('missed_calls')
    .select('missed_at')
    .eq('client_id', clientId)
    .gte('missed_at', dateFrom)
    .lte('missed_at', dateTo + 'T23:59:59')

  if (error) return { data: [], error }

  const grouped: Record<string, number> = {}
  for (const row of data || []) {
    const date = row.missed_at.split('T')[0]
    grouped[date] = (grouped[date] || 0) + 1
  }

  const result = Object.entries(grouped).map(([date, count]) => ({ date, count }))
  return { data: result, error: null }
}

export async function getRevenueByWeek({ clientId, dateFrom, dateTo }: DateRange) {
  const { data, error } = await supabase
    .from('interactions')
    .select('created_at, estimated_value')
    .eq('client_id', clientId)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59')
    .not('estimated_value', 'is', null)

  if (error) return { data: [], error }

  // Group by ISO week
  const grouped: Record<string, number> = {}
  for (const row of data || []) {
    const date = new Date(row.created_at)
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay())
    const weekKey = weekStart.toISOString().split('T')[0]
    grouped[weekKey] = (grouped[weekKey] || 0) + (row.estimated_value || 0)
  }

  const result = Object.entries(grouped).map(([week, revenue]) => ({ week, revenue }))
  return { data: result, error: null }
}

export async function getTopServices({ clientId, dateFrom, dateTo }: DateRange) {
  const { data, error } = await supabase
    .from('bookings')
    .select('service_type')
    .eq('client_id', clientId)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo + 'T23:59:59')
    .not('service_type', 'is', null)

  if (error) return { data: [], error }

  const grouped: Record<string, number> = {}
  for (const row of data || []) {
    const key = row.service_type || 'Other'
    grouped[key] = (grouped[key] || 0) + 1
  }

  const result = Object.entries(grouped)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  return { data: result, error: null }
}

export async function getDashboardStats(clientId: string) {
  const today = new Date().toISOString().split('T')[0]

  const [callsRes, bookingsRes, missedRes, revenueRes] = await Promise.all([
    supabase
      .from('interactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', today),
    supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('created_at', today)
      .neq('status', 'cancelled'),
    supabase
      .from('missed_calls')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .gte('missed_at', today),
    supabase
      .from('interactions')
      .select('estimated_value')
      .eq('client_id', clientId)
      .gte('created_at', today)
      .not('estimated_value', 'is', null),
  ])

  const totalRevenue = (revenueRes.data || []).reduce((sum, r) => sum + (r.estimated_value || 0), 0)

  return {
    todayCalls: callsRes.count || 0,
    todayBookings: bookingsRes.count || 0,
    todayMissedCalls: missedRes.count || 0,
    todayRevenue: totalRevenue,
  }
}
