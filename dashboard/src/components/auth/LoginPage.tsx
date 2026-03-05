import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const { signIn, resetPassword } = useAuth()
  const navigate = useNavigate()

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await signIn(email, password)
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      navigate('/dashboard')
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await resetPassword(email)
    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-brand-800">RunBy</h1>
          <p className="text-gray-500 mt-2">AI Receptionist Dashboard</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          {showForgot ? (
            <>
              <h2 className="text-xl font-semibold mb-6">Reset Password</h2>
              {resetSent ? (
                <div className="text-center">
                  <p className="text-green-600 mb-4">Check your email for a reset link.</p>
                  <button
                    onClick={() => { setShowForgot(false); setResetSent(false) }}
                    className="text-brand-600 hover:underline text-sm"
                  >
                    Back to login
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReset}>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      placeholder="you@example.com"
                    />
                  </div>
                  {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-brand-600 text-white py-2 px-4 rounded-md hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForgot(false)}
                    className="w-full mt-3 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Back to login
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold mb-6">Sign in to your account</h2>
              <form onSubmit={handleLogin}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    placeholder="you@example.com"
                  />
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    placeholder="Enter your password"
                  />
                </div>
                {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-600 text-white py-2 px-4 rounded-md hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
              <button
                onClick={() => setShowForgot(true)}
                className="w-full mt-4 text-sm text-gray-500 hover:text-brand-600"
              >
                Forgot password?
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
