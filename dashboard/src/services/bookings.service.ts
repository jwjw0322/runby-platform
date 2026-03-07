import { supabase } from '@/config/supabase'
import type { Booking } from '@/types/database'

interface BookingFilters {
  clientId: string
  status?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  page?: number
  pageSize?: number
}

export async function getBookings({ clientId, status, dateFrom, dateTo, search, page = 0, pageSize = 20 }: BookingFilters) {
  let query = supabase
    .from('bookings')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('scheduled_date', { ascending: false })
    .order('scheduled_time', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }
  if (dateFrom) {
    query = query.gte('scheduled_date', dateFrom)
  }
  if (dateTo) {
    query = query.lte('scheduled_date', dateTo)
  }
  if (search) {
    query = query.or(`customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`)
  }

  const { data, count, error } = await query
  return { bookings: (data || []) as Booking[], total: count || 0, error }
}

export async function getBookingById(id: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', id)
    .single()
  return { booking: data as Booking | null, error }
}

export async function updateBooking(id: string, updates: Partial<Booking>) {
  const { data, error } = await supabase
    .from('bookings')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  return { booking: data as Booking | null, error }
}

export async function cancelBooking(id: string) {
  return updateBooking(id, { status: 'cancelled' })
}

export async function getTodayBookings(clientId: string) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_id', clientId)
    .eq('scheduled_date', today)
    .neq('status', 'cancelled')
    .order('scheduled_time', { ascending: true })

  return { bookings: (data || []) as Booking[], error }
}

export async function getUpcomingBookings(clientId: string, limit = 5) {
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_id', clientId)
    .gte('scheduled_date', today)
    .neq('status', 'cancelled')
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
    .limit(limit)

  return { bookings: (data || []) as Booking[], error }
}
