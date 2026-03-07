import { supabase } from '@/config/supabase'
import type { ClientConfig } from '@/types/database'

export async function getClientConfig(clientId: string) {
  const { data, error } = await supabase
    .from('client_config')
    .select('*')
    .eq('client_id', clientId)
    .single()
  return { config: data as ClientConfig | null, error }
}

export async function updateBusinessHours(clientId: string, business_hours: Record<string, { open: string; close: string }>) {
  const { data, error } = await supabase
    .from('client_config')
    .update({ business_hours, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .select()
    .single()
  return { config: data as ClientConfig | null, error }
}

export async function updateServices(clientId: string, services: string[]) {
  const { data, error } = await supabase
    .from('client_config')
    .update({ services, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .select()
    .single()
  return { config: data as ClientConfig | null, error }
}

export async function updateAIConfig(clientId: string, updates: { ai_name?: string; languages?: string[] }) {
  const { data, error } = await supabase
    .from('client_config')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .select()
    .single()
  return { config: data as ClientConfig | null, error }
}

export async function updateServiceArea(clientId: string, service_area: string) {
  const { data, error } = await supabase
    .from('client_config')
    .update({ service_area, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .select()
    .single()
  return { config: data as ClientConfig | null, error }
}

export async function updateTransferNumbers(clientId: string, transfer_numbers: { number: string; label?: string }[]) {
  const { data, error } = await supabase
    .from('client_config')
    .update({ transfer_numbers, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .select()
    .single()
  return { config: data as ClientConfig | null, error }
}

export async function updateTimezone(clientId: string, timezone: string) {
  const { data, error } = await supabase
    .from('client_config')
    .update({ timezone, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .select()
    .single()
  return { config: data as ClientConfig | null, error }
}
