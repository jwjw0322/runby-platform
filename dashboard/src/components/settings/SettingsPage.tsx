import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useClient } from '@/context/ClientContext'
import { getClientConfig, updateBusinessHours, updateServices, updateAIConfig, updateServiceArea, updateTransferNumbers, updateTimezone } from '@/services/config.service'
import { cn } from '@/lib/utils'
import type { ClientConfig } from '@/types/database'

const tabs = ['Business Hours', 'Services', 'AI Config', 'Service Area', 'Transfer Numbers', 'Timezone']
const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const dayLabels: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

const timezones = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
]

export function SettingsPage() {
  const { clientId, role } = useClient()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState(0)
  const [message, setMessage] = useState('')
  const canEdit = role === 'owner' || role === 'admin'

  const { data } = useQuery({
    queryKey: ['clientConfig', clientId],
    queryFn: () => getClientConfig(clientId!),
    enabled: !!clientId,
  })

  const config = data?.config

  function showSuccess() {
    setMessage('Saved successfully!')
    setTimeout(() => setMessage(''), 3000)
  }

  function invalidateConfig() {
    queryClient.invalidateQueries({ queryKey: ['clientConfig', clientId] })
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      {message && (
        <div className="mb-4 px-4 py-2 bg-green-50 text-green-700 rounded-md text-sm border border-green-200">
          {message}
        </div>
      )}

      {!canEdit && (
        <div className="mb-4 px-4 py-2 bg-yellow-50 text-yellow-700 rounded-md text-sm border border-yellow-200">
          You have view-only access. Contact your account owner to make changes.
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === i
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        {config ? (
          <>
            {activeTab === 0 && <BusinessHoursTab config={config} clientId={clientId!} canEdit={canEdit} onSave={() => { invalidateConfig(); showSuccess() }} />}
            {activeTab === 1 && <ServicesTab config={config} clientId={clientId!} canEdit={canEdit} onSave={() => { invalidateConfig(); showSuccess() }} />}
            {activeTab === 2 && <AIConfigTab config={config} clientId={clientId!} canEdit={canEdit} onSave={() => { invalidateConfig(); showSuccess() }} />}
            {activeTab === 3 && <ServiceAreaTab config={config} clientId={clientId!} canEdit={canEdit} onSave={() => { invalidateConfig(); showSuccess() }} />}
            {activeTab === 4 && <TransferNumbersTab config={config} clientId={clientId!} canEdit={canEdit} onSave={() => { invalidateConfig(); showSuccess() }} />}
            {activeTab === 5 && <TimezoneTab config={config} clientId={clientId!} canEdit={canEdit} onSave={() => { invalidateConfig(); showSuccess() }} />}
          </>
        ) : (
          <p className="text-gray-500">Loading configuration...</p>
        )}
      </div>
    </div>
  )
}

// === Business Hours Tab ===
function BusinessHoursTab({ config, clientId, canEdit, onSave }: { config: ClientConfig; clientId: string; canEdit: boolean; onSave: () => void }) {
  const [hours, setHours] = useState(config.business_hours || {})

  const mutation = useMutation({
    mutationFn: () => updateBusinessHours(clientId, hours),
    onSuccess: onSave,
  })

  function updateDay(day: string, field: 'open' | 'close', value: string) {
    setHours(prev => ({ ...prev, [day]: { ...prev[day], [field]: value } }))
  }

  function toggleClosed(day: string) {
    setHours(prev => {
      const copy = { ...prev }
      if (copy[day]) {
        delete copy[day]
      } else {
        copy[day] = { open: '09:00', close: '17:00' }
      }
      return copy
    })
  }

  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-4">Business Hours</h3>
      <div className="space-y-3">
        {days.map(day => (
          <div key={day} className="flex items-center gap-4">
            <span className="w-24 text-sm font-medium text-gray-700">{dayLabels[day]}</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!hours[day]}
                onChange={() => toggleClosed(day)}
                disabled={!canEdit}
                className="rounded"
              />
              <span className="text-sm text-gray-600">{hours[day] ? 'Open' : 'Closed'}</span>
            </label>
            {hours[day] && (
              <>
                <input
                  type="time"
                  value={hours[day]?.open || '09:00'}
                  onChange={e => updateDay(day, 'open', e.target.value)}
                  disabled={!canEdit}
                  className="px-2 py-1 border rounded text-sm"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="time"
                  value={hours[day]?.close || '17:00'}
                  onChange={e => updateDay(day, 'close', e.target.value)}
                  disabled={!canEdit}
                  className="px-2 py-1 border rounded text-sm"
                />
              </>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="mt-6 px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50">
          {mutation.isPending ? 'Saving...' : 'Save Hours'}
        </button>
      )}
    </div>
  )
}

// === Services Tab ===
function ServicesTab({ config, clientId, canEdit, onSave }: { config: ClientConfig; clientId: string; canEdit: boolean; onSave: () => void }) {
  const [services, setServices] = useState<string[]>(config.services || [])
  const [newService, setNewService] = useState('')

  const mutation = useMutation({
    mutationFn: () => updateServices(clientId, services),
    onSuccess: onSave,
  })

  function addService() {
    if (newService.trim() && !services.includes(newService.trim())) {
      setServices([...services, newService.trim()])
      setNewService('')
    }
  }

  function removeService(index: number) {
    setServices(services.filter((_, i) => i !== index))
  }

  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-4">Services Offered</h3>
      <div className="space-y-2 mb-4">
        {services.map((service, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="flex-1 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded">{service}</span>
            {canEdit && (
              <button onClick={() => removeService(i)} className="text-red-500 hover:text-red-700 text-sm px-2">Remove</button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex gap-2 mb-4">
          <input
            value={newService}
            onChange={e => setNewService(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addService()}
            placeholder="Add a service..."
            className="flex-1 px-3 py-2 border rounded-md text-sm"
          />
          <button onClick={addService} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200">Add</button>
        </div>
      )}
      {canEdit && (
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50">
          {mutation.isPending ? 'Saving...' : 'Save Services'}
        </button>
      )}
    </div>
  )
}

// === AI Config Tab ===
function AIConfigTab({ config, clientId, canEdit, onSave }: { config: ClientConfig; clientId: string; canEdit: boolean; onSave: () => void }) {
  const [aiName, setAiName] = useState(config.ai_name || 'Alex')
  const [languages, setLanguages] = useState<string[]>(config.languages || ['en'])

  const mutation = useMutation({
    mutationFn: () => updateAIConfig(clientId, { ai_name: aiName, languages }),
    onSuccess: onSave,
  })

  function toggleLanguage(lang: string) {
    setLanguages(prev => prev.includes(lang) ? prev.filter(l => l !== lang) : [...prev, lang])
  }

  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-4">AI Assistant Configuration</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">AI Name</label>
          <input value={aiName} onChange={e => setAiName(e.target.value)} disabled={!canEdit} className="w-64 px-3 py-2 border rounded-md text-sm" />
          <p className="text-xs text-gray-500 mt-1">The name your AI receptionist introduces itself as</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Languages</label>
          <div className="flex gap-4">
            {[{ code: 'en', label: 'English' }, { code: 'es', label: 'Spanish' }].map(lang => (
              <label key={lang.code} className="flex items-center gap-2">
                <input type="checkbox" checked={languages.includes(lang.code)} onChange={() => toggleLanguage(lang.code)} disabled={!canEdit} className="rounded" />
                <span className="text-sm">{lang.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {canEdit && (
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="mt-6 px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50">
          {mutation.isPending ? 'Saving...' : 'Save AI Config'}
        </button>
      )}
    </div>
  )
}

// === Service Area Tab ===
function ServiceAreaTab({ config, clientId, canEdit, onSave }: { config: ClientConfig; clientId: string; canEdit: boolean; onSave: () => void }) {
  const [area, setArea] = useState(config.service_area || '')

  const mutation = useMutation({
    mutationFn: () => updateServiceArea(clientId, area),
    onSuccess: onSave,
  })

  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-4">Service Area</h3>
      <input value={area} onChange={e => setArea(e.target.value)} disabled={!canEdit} placeholder="e.g., Miami-Dade County, FL" className="w-full max-w-md px-3 py-2 border rounded-md text-sm" />
      <p className="text-xs text-gray-500 mt-1">The geographic area your business serves</p>
      {canEdit && (
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="mt-6 px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50">
          {mutation.isPending ? 'Saving...' : 'Save Service Area'}
        </button>
      )}
    </div>
  )
}

// === Transfer Numbers Tab ===
function TransferNumbersTab({ config, clientId, canEdit, onSave }: { config: ClientConfig; clientId: string; canEdit: boolean; onSave: () => void }) {
  const [numbers, setNumbers] = useState<{ number: string; label?: string }[]>(config.transfer_numbers || [])
  const [newNumber, setNewNumber] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const mutation = useMutation({
    mutationFn: () => updateTransferNumbers(clientId, numbers),
    onSuccess: onSave,
  })

  function addNumber() {
    if (newNumber.trim()) {
      setNumbers([...numbers, { number: newNumber.trim(), label: newLabel.trim() || undefined }])
      setNewNumber('')
      setNewLabel('')
    }
  }

  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-4">Transfer Numbers</h3>
      <p className="text-sm text-gray-500 mb-4">Phone numbers the AI can transfer calls to when needed.</p>
      <div className="space-y-2 mb-4">
        {numbers.map((num, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-sm font-mono bg-gray-50 px-3 py-2 rounded">{num.number}</span>
            {num.label && <span className="text-sm text-gray-500">({num.label})</span>}
            {canEdit && (
              <button onClick={() => setNumbers(numbers.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700 text-sm">Remove</button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="flex gap-2 mb-4">
          <input value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="+13055551234" className="w-44 px-3 py-2 border rounded-md text-sm font-mono" />
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (optional)" className="w-40 px-3 py-2 border rounded-md text-sm" />
          <button onClick={addNumber} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200">Add</button>
        </div>
      )}
      {canEdit && (
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50">
          {mutation.isPending ? 'Saving...' : 'Save Numbers'}
        </button>
      )}
    </div>
  )
}

// === Timezone Tab ===
function TimezoneTab({ config, clientId, canEdit, onSave }: { config: ClientConfig; clientId: string; canEdit: boolean; onSave: () => void }) {
  const [tz, setTz] = useState(config.timezone || 'America/New_York')

  const mutation = useMutation({
    mutationFn: () => updateTimezone(clientId, tz),
    onSuccess: onSave,
  })

  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-4">Timezone</h3>
      <select value={tz} onChange={e => setTz(e.target.value)} disabled={!canEdit} className="w-64 px-3 py-2 border rounded-md text-sm">
        {timezones.map(t => (
          <option key={t} value={t}>{t.replace('_', ' ').replace('America/', '')}</option>
        ))}
      </select>
      <p className="text-xs text-gray-500 mt-1">Used for business hours and scheduling</p>
      {canEdit && (
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="mt-6 px-4 py-2 bg-brand-600 text-white text-sm rounded-md hover:bg-brand-700 disabled:opacity-50">
          {mutation.isPending ? 'Saving...' : 'Save Timezone'}
        </button>
      )}
    </div>
  )
}
