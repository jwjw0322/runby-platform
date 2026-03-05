import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '@/config/supabase'
import { useAuth } from './AuthContext'
import type { ClientUser, Client, ClientConfig } from '@/types/database'

interface ClientContextType {
  clientId: string | null
  client: Client | null
  config: ClientConfig | null
  role: ClientUser['role'] | null
  clients: { id: string; business_name: string }[]
  switchClient: (clientId: string) => void
  loading: boolean
}

const ClientContext = createContext<ClientContextType | undefined>(undefined)

export function ClientProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [clientId, setClientId] = useState<string | null>(null)
  const [client, setClient] = useState<Client | null>(null)
  const [config, setConfig] = useState<ClientConfig | null>(null)
  const [role, setRole] = useState<ClientUser['role'] | null>(null)
  const [clients, setClients] = useState<{ id: string; business_name: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setClientId(null)
      setClient(null)
      setConfig(null)
      setRole(null)
      setClients([])
      setLoading(false)
      return
    }

    loadClientAccess()
  }, [user])

  useEffect(() => {
    if (clientId) {
      loadClientDetails(clientId)
    }
  }, [clientId])

  async function loadClientAccess() {
    setLoading(true)
    // Get all clients this user has access to
    const { data: memberships, error } = await supabase
      .from('client_users')
      .select('client_id, role')
      .eq('user_id', user!.id)

    if (error || !memberships?.length) {
      setLoading(false)
      return
    }

    // Get client names for the switcher
    const clientIds = memberships.map(m => m.client_id)
    const { data: clientList } = await supabase
      .from('clients')
      .select('id, business_name')
      .in('id', clientIds)

    setClients(clientList || [])

    // Default to first client
    const firstMembership = memberships[0]
    setClientId(firstMembership.client_id)
    setRole(firstMembership.role as ClientUser['role'])
    setLoading(false)
  }

  async function loadClientDetails(id: string) {
    const [clientRes, configRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).single(),
      supabase.from('client_config').select('*').eq('client_id', id).single(),
    ])

    setClient(clientRes.data as Client | null)
    setConfig(configRes.data as ClientConfig | null)
  }

  function switchClient(newClientId: string) {
    setClientId(newClientId)
  }

  return (
    <ClientContext.Provider value={{ clientId, client, config, role, clients, switchClient, loading }}>
      {children}
    </ClientContext.Provider>
  )
}

export function useClient() {
  const context = useContext(ClientContext)
  if (!context) throw new Error('useClient must be used within ClientProvider')
  return context
}
