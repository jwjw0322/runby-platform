import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryKey } from '@tanstack/react-query'
import { supabase } from '@/config/supabase'
import { useClient } from '@/context/ClientContext'

/**
 * Subscribe to Supabase realtime changes for a table.
 * Automatically invalidates the matching TanStack Query key on INSERT/UPDATE.
 */
export function useRealtime(table: string, queryKey: QueryKey) {
  const queryClient = useQueryClient()
  const { clientId } = useClient()

  useEffect(() => {
    if (!clientId) return

    const channel = supabase
      .channel(`${table}:${clientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `client_id=eq.${clientId}`,
        },
        () => {
          // Invalidate the query so it refetches
          queryClient.invalidateQueries({ queryKey })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, clientId, queryKey, queryClient])
}
