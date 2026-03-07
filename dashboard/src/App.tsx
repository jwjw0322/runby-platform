import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { AuthProvider } from '@/context/AuthContext'
import { ClientProvider } from '@/context/ClientContext'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { LoginPage } from '@/components/auth/LoginPage'
import { Layout } from '@/components/common/Layout'
import { DashboardHome } from '@/components/dashboard/DashboardHome'
import { BookingsPage } from '@/components/bookings/BookingsPage'
import { CallHistoryPage } from '@/components/calls/CallHistoryPage'
import { AnalyticsPage } from '@/components/analytics/AnalyticsPage'
import { SettingsPage } from '@/components/settings/SettingsPage'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <ClientProvider>
                    <Layout />
                  </ClientProvider>
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardHome />} />
              <Route path="bookings" element={<BookingsPage />} />
              <Route path="calls" element={<CallHistoryPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
