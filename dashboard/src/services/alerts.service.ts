import { supabase } from '@/config/supabase'
import type { Alert } from '@/types/database'

export async function getAlerts(clientId: string, unreadOnly = false, limit = 20) {
  let query = supabase
    .from('alerts')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) {
    query = query.eq('read', false)
  }

  const { data, error } = await query
  return { alerts: (data || []) as Alert[], error }
}

export async function getUnreadAlertCount(clientId: string) {
  const { count, error } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('read', false)

  return { count: count || 0, error }
}

export async function markAlertRead(alertId: string) {
  const { error } = await supabase
    .from('alerts')
    .update({ read: true })
    .eq('id', alertId)
  return { error }
}

export async function markAllAlertsRead(clientId: string) {
  const { error } = await supabase
    .from('alerts')
    .update({ read: true })
    .eq('client_id', clientId)
    .eq('read', false)
  return { error }
}
