import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useClient } from '@/context/ClientContext'
import { getBookings, cancelBooking, updateBooking } from '@/services/bookings.service'
import { useRealtime } from '@/hooks/useRealtime'
import { formatPhone, capitalize, cn } from '@/lib/utils'
import type { Booking } from '@/types/database'

const statusColors: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-gray-100 text-gray-700',
}

export function BookingsPage() {
  const { clientId, role } = useClient()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null)

  const queryKey = ['bookings', clientId, page, status, search]
  useRealtime('bookings', ['bookings', clientId!])

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => getBookings({ clientId: clientId!, status, search: search || undefined, page }),
    enabled: !!clientId,
  })

  const cancelMutation = useMutation({
    mutationFn: cancelBooking,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings', clientId] }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Booking> }) => updateBooking(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings', clientId] })
      setEditingBooking(null)
    },
  })

  const bookings = data?.bookings || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / 20)
  const canEdit = role === 'owner' || role === 'admin'

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Bookings</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
        />
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Service</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date & Time</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                {canEdit && <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-500">Loading...</td></tr>
              ) : bookings.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-500">No bookings found</td></tr>
              ) : (
                bookings.map(booking => (
                  <tr key={booking.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{booking.customer_name || '—'}</p>
                      <p className="text-xs text-gray-500">{formatPhone(booking.customer_phone)}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{booking.service_type || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {booking.scheduled_date || '—'}
                      {booking.scheduled_time ? ` at ${booking.scheduled_time}` : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', statusColors[booking.status])}>
                        {capitalize(booking.status)}
                      </span>
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingBooking(booking)}
                            className="text-xs text-brand-600 hover:underline"
                          >
                            Edit
                          </button>
                          {booking.status !== 'cancelled' && (
                            <button
                              onClick={() => {
                                if (confirm('Cancel this booking?')) cancelMutation.mutate(booking.id)
                              }}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-500">{total} bookings total</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingBooking && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Edit Booking</h2>
            <form
              onSubmit={e => {
                e.preventDefault()
                const form = new FormData(e.currentTarget)
                updateMutation.mutate({
                  id: editingBooking.id,
                  updates: {
                    customer_name: form.get('customer_name') as string,
                    service_type: form.get('service_type') as string,
                    scheduled_date: form.get('scheduled_date') as string,
                    scheduled_time: form.get('scheduled_time') as string,
                  },
                })
              }}
            >
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
                  <input name="customer_name" defaultValue={editingBooking.customer_name || ''} className="w-full px-3 py-2 border rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Service</label>
                  <input name="service_type" defaultValue={editingBooking.service_type || ''} className="w-full px-3 py-2 border rounded-md text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <input name="scheduled_date" type="date" defaultValue={editingBooking.scheduled_date || ''} className="w-full px-3 py-2 border rounded-md text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
                    <input name="scheduled_time" defaultValue={editingBooking.scheduled_time || ''} className="w-full px-3 py-2 border rounded-md text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setEditingBooking(null)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md">
                  Cancel
                </button>
                <button type="submit" disabled={updateMutation.isPending} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-md hover:bg-brand-700 disabled:opacity-50">
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
