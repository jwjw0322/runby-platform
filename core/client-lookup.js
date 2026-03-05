// core/client-lookup.js
// Routes incoming calls to the correct client by looking up the Twilio phone number
// Caches results in memory to avoid hitting the database on every webhook event

const supabase = require('./supabase');

// In-memory cache: phone number → client + config
const clientCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Look up a client by the Twilio phone number that was called
 * Returns { client, config } or null if not found
 */
async function getClientByPhone(phoneNumber) {
  if (!phoneNumber) return null;

  // Normalize phone number (strip spaces, ensure +1 prefix)
  const normalized = phoneNumber.replace(/\s/g, '');

  // Check cache first
  const cached = clientCache.get(normalized);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`[Lookup] Cache hit for ${normalized}: ${cached.data.client.business_name}`);
    return cached.data;
  }

  console.log(`[Lookup] Querying Supabase for phone: ${normalized}`);

  // Look up the client by their Twilio number
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('*')
    .eq('twilio_number', normalized)
    .single();

  if (clientError || !client) {
    console.warn(`[Lookup] No client found for phone: ${normalized}`);
    return null;
  }

  // Get their config
  const { data: config, error: configError } = await supabase
    .from('client_config')
    .select('*')
    .eq('client_id', client.id)
    .single();

  if (configError || !config) {
    console.warn(`[Lookup] No config found for client: ${client.id} (${client.business_name})`);
    return null;
  }

  // Format services from JSONB array to string
  let servicesStr = '';
  if (Array.isArray(config.services)) {
    servicesStr = config.services.join(', ');
  } else if (typeof config.services === 'string') {
    servicesStr = config.services;
  }

  // Format business hours from JSONB to readable string
  let hoursStr = '';
  if (typeof config.business_hours === 'object' && config.business_hours !== null) {
    const dayNames = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
    const parts = [];
    for (const [day, hours] of Object.entries(config.business_hours)) {
      if (hours.open && hours.close) {
        parts.push(`${dayNames[day] || day} ${hours.open}-${hours.close}`);
      }
    }
    hoursStr = parts.join(', ');
  } else if (typeof config.business_hours === 'string') {
    hoursStr = config.business_hours;
  }

  const result = {
    client: {
      id: client.id,
      name: client.name,
      business_name: client.business_name,
      vertical_id: client.vertical_id,
      phone: client.phone,
      email: client.email,
      twilio_number: client.twilio_number,
      status: client.status,
    },
    config: {
      business_name: config.business_name,
      vertical_id: config.vertical_id,
      service_area: config.service_area || '',
      services: servicesStr,
      business_hours: hoursStr,
      routing_mode: config.routing_mode,
      ring_timeout_seconds: config.ring_timeout_seconds,
      transfer_numbers: config.transfer_numbers || [],
      ai_name: config.ai_name || 'Alex',
      languages: config.languages || ['en'],
      owner_email: config.owner_email || '',
      timezone: config.timezone || 'America/New_York',
    },
  };

  // Cache it
  clientCache.set(normalized, { data: result, timestamp: Date.now() });
  console.log(`[Lookup] Found client: ${client.business_name} (${client.id})`);

  return result;
}

/**
 * Look up a client by their client_id (for post-call processing)
 */
async function getClientById(clientId) {
  if (!clientId) return null;

  // Check cache (search by client_id in cached values)
  for (const [, cached] of clientCache) {
    if (cached.data.client.id === clientId && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (error || !client) return null;

  // Reuse the phone lookup to populate and cache
  return getClientByPhone(client.twilio_number);
}

/**
 * Clear the cache (useful after onboarding a new client)
 */
function clearCache() {
  clientCache.clear();
  console.log('[Lookup] Cache cleared');
}

module.exports = { getClientByPhone, getClientById, clearCache };
