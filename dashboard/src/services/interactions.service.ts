import { supabase } from '@/config/supabase'
import type { Interaction, Transcript } from '@/types/database'

interface InteractionFilters {
  clientId: string
  classification?: string
  outcome?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export async function getInteractions({ clientId, classification, outcome, dateFrom, dateTo, page = 0, pageSize = 20 }: InteractionFilters) {
  let query = supabase
    .from('interactions')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (classification && classification !== 'all') {
    query = query.eq('classification', classification)
  }
  if (outcome && outcome !== 'all') {
    query = query.eq('outcome', outcome)
  }
  if (dateFrom) {
    query = query.gte('created_at', dateFrom)
  }
  if (dateTo) {
    query = query.lte('created_at', dateTo + 'T23:59:59')
  }

  const { data, count, error } = await query
  return { interactions: (data || []) as Interaction[], total: count || 0, error }
}

export async function getTranscript(interactionId: string) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('interaction_id', interactionId)
    .single()
  return { transcript: data as Transcript | null, error }
}

export async function getRecentInteractions(clientId: string, limit = 10) {
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return { interactions: (data || []) as Interaction[], error }
}

export async function getTodayCallCount(clientId: string) {
  const today = new Date().toISOString().split('T')[0]
  const { count, error } = await supabase
    .from('interactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', today)

  return { count: count || 0, error }
}
