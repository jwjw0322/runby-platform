// core/onboarding-handler.js
// Handles save_onboarding_data function call from the onboarding voice assistant
// Saves collected info to onboarding_requests table and notifies admin

require('dotenv').config();
const supabase = require('./supabase');
const { sendOnboardingNotification } = require('./email-sender');

/**
 * Save onboarding data collected via voice call
 * Called by Vapi when the onboarding assistant triggers save_onboarding_data
 */
async function saveOnboardingData(params) {
  const {
    business_name,
    vertical_id,
    owner_name,
    owner_email,
    owner_phone,
    service_area,
    services,
    business_hours,
    ai_name,
    timezone,
    preferred_area_code,
  } = params;

  console.log(`\n[Onboarding] Saving new onboarding request...`);
  console.log(`  Business: ${business_name}`);
  console.log(`  Owner: ${owner_name} (${owner_email})`);
  console.log(`  Vertical: ${vertical_id}`);

  // Validate required fields
  const required = ['business_name', 'vertical_id', 'owner_name', 'owner_email', 'owner_phone', 'service_area', 'services', 'business_hours'];
  const missing = required.filter(field => !params[field]);

  if (missing.length > 0) {
    console.log(`[Onboarding] Missing fields: ${missing.join(', ')}`);
    return {
      success: false,
      message: `I'm still missing some information: ${missing.join(', ')}. Could you please provide those details?`,
    };
  }

  // Parse services into JSON array if it's a comma-separated string
  let servicesArray = [];
  if (typeof services === 'string') {
    servicesArray = services.split(',').map(s => s.trim()).filter(Boolean);
  } else if (Array.isArray(services)) {
    servicesArray = services;
  }

  // Parse business hours into structured JSONB
  const hoursObj = parseBusinessHours(business_hours);

  // Insert into onboarding_requests table
  const { data: request, error } = await supabase
    .from('onboarding_requests')
    .insert({
      business_name,
      vertical_id: (vertical_id || 'general').toLowerCase(),
      owner_name,
      owner_email,
      owner_phone,
      service_area,
      services: servicesArray,
      business_hours: hoursObj,
      ai_name: ai_name || 'Alex',
      timezone: timezone || 'America/New_York',
      preferred_area_code: preferred_area_code || null,
      status: 'pending',
      transcribed_data: params,  // Store raw params for audit
    })
    .select()
    .single();

  if (error) {
    console.error('[Onboarding] Database error:', error.message);
    return {
      success: false,
      message: 'There was a technical issue saving your information. Our team has been notified and will follow up with you directly.',
    };
  }

  console.log(`[Onboarding] Request saved: ${request.id}`);

  // Send notification email to admin (Jon)
  try {
    await sendOnboardingNotification({
      onboarding_request_id: request.id,
      business_name,
      owner_name,
      owner_email,
      owner_phone,
      vertical_id: (vertical_id || 'general').toLowerCase(),
      service_area,
      services: servicesArray,
      business_hours: business_hours, // Keep original string for email readability
      ai_name: ai_name || 'Alex',
      timezone: timezone || 'America/New_York',
      preferred_area_code,
    });
    console.log('[Onboarding] Admin notification email sent');
  } catch (emailErr) {
    console.error('[Onboarding] Email notification failed:', emailErr.message);
    // Don't fail the save — data is already in DB
  }

  return {
    success: true,
    message: `Your information has been saved! Our team will review everything and get your phone number set up within 24 hours. You'll get a confirmation email at ${owner_email}.`,
  };
}

/**
 * Parse business hours from natural language into structured JSONB
 * Reuses the same logic from onboard-client.js
 *
 * Input:  "Mon-Fri 8AM-6PM, Sat 9AM-2PM"
 * Output: { mon: {open:"08:00",close:"18:00"}, tue: {...}, ... }
 */
function parseBusinessHours(hoursStr) {
  if (!hoursStr) return {};

  const dayMap = {
    'mon': 'mon', 'tue': 'tue', 'wed': 'wed', 'thu': 'thu', 'fri': 'fri', 'sat': 'sat', 'sun': 'sun',
    'monday': 'mon', 'tuesday': 'tue', 'wednesday': 'wed', 'thursday': 'thu',
    'friday': 'fri', 'saturday': 'sat', 'sunday': 'sun',
  };

  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

  function convertTime(t) {
    t = t.trim().toUpperCase();
    const match = t.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/);
    if (!match) return t;
    let hours = parseInt(match[1]);
    const mins = match[2] || '00';
    const ampm = match[3];
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${mins}`;
  }

  const result = {};
  const segments = hoursStr.split(',');

  for (const segment of segments) {
    const trimmed = segment.trim();
    const match = trimmed.match(/(\w+)(?:\s*-\s*(\w+))?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
    if (!match) continue;

    const startDay = dayMap[match[1].toLowerCase()];
    const endDay = match[2] ? dayMap[match[2].toLowerCase()] : startDay;
    const openTime = convertTime(match[3]);
    const closeTime = convertTime(match[4]);

    if (!startDay) continue;

    const startIdx = dayOrder.indexOf(startDay);
    const endIdx = dayOrder.indexOf(endDay || startDay);

    for (let i = startIdx; i <= endIdx; i++) {
      result[dayOrder[i]] = { open: openTime, close: closeTime };
    }
  }

  return result;
}

module.exports = { saveOnboardingData };
