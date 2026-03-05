// TypeScript interfaces matching the RunBy Supabase schema

export interface Client {
  id: string
  name: string
  business_name: string
  vertical_id: string
  phone: string | null
  email: string | null
  twilio_number: string | null
  status: 'pilot' | 'active' | 'inactive'
  created_at: string
}

export interface ClientConfig {
  id: string
  client_id: string
  vertical_id: string
  business_name: string
  business_hours: Record<string, { open: string; close: string }>
  services: string[]
  service_area: string | null
  routing_mode: string
  ring_timeout_seconds: number
  transfer_numbers: { number: string; label?: string }[]
  ai_name: string
  languages: string[]
  briefing_time: string
  review_request_delay_hours: number
  owner_email: string | null
  timezone: string
  created_at: string
  updated_at: string
}

export interface Interaction {
  id: string
  client_id: string
  vertical_id: string
  type: 'call' | 'sms' | 'email' | 'chat'
  direction: 'inbound' | 'outbound'
  caller_number: string | null
  caller_name: string | null
  language: string
  module: string | null
  classification: 'booking' | 'emergency' | 'inquiry' | 'estimate' | 'maintenance' | null
  outcome: 'booked' | 'transferred' | 'voicemail' | 'resolved' | null
  estimated_value: number | null
  duration_seconds: number | null
  transcript_id: string | null
  source: string | null
  notes: string | null
  created_at: string
}

export interface Transcript {
  id: string
  interaction_id: string
  client_id: string
  full_text: string | null
  summary: string | null
  action_items: string[]
  sentiment: 'positive' | 'neutral' | 'negative' | null
  created_at: string
}

export interface Booking {
  id: string
  client_id: string
  vertical_id: string
  interaction_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  service_type: string | null
  provider: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  estimated_value: number | null
  source: string | null
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed'
  created_at: string
}

export interface MissedCall {
  id: string
  client_id: string
  vertical_id: string
  caller_number: string
  caller_name: string | null
  missed_at: string
  callback_attempted_at: string | null
  callback_outcome: 'booked' | 'voicemail' | 'no_answer' | 'not_interested' | null
  revenue_recovered: number | null
  status: 'pending' | 'attempted' | 'recovered' | 'closed'
}

export interface Estimate {
  id: string
  client_id: string
  vertical_id: string
  customer_name: string | null
  customer_phone: string | null
  service_type: string | null
  amount: number | null
  sent_date: string | null
  follow_up_stage: number
  last_follow_up: string | null
  outcome: 'pending' | 'converted' | 'lost'
  converted_date: string | null
  converted_revenue: number | null
  created_at: string
}

export interface Review {
  id: string
  client_id: string
  vertical_id: string
  type: 'request_sent' | 'review_received'
  customer_name: string | null
  customer_phone: string | null
  platform: string
  rating: number | null
  review_text: string | null
  response_text: string | null
  created_at: string
}

export interface Alert {
  id: string
  client_id: string
  type: 'emergency' | 'negative_review' | 'failed_transfer' | 'high_value_lead'
  severity: 'info' | 'warning' | 'critical'
  message: string
  interaction_id: string | null
  read: boolean
  action_taken: string | null
  created_at: string
}

export interface ClientUser {
  id: string
  client_id: string
  user_id: string
  email: string
  role: 'owner' | 'admin' | 'viewer'
  created_at: string
}

// Interaction with joined transcript
export interface InteractionWithTranscript extends Interaction {
  transcript?: Transcript | null
}
