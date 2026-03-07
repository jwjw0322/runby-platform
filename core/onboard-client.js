// core/onboard-client.js
// Interactive script to onboard a new client
// Run: node core/onboard-client.js

require('dotenv').config();
const readline = require('readline');
const supabase = require('./supabase');
const { clearCache } = require('./client-lookup');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function onboardClient() {
  console.log('\n========================================');
  console.log('  RunBy — New Client Onboarding');
  console.log('========================================\n');

  // 1. Collect client details
  const businessName = await ask('Business name: ');
  const vertical = await ask('Vertical (hvac/plumbing/electrical): ');
  const ownerName = await ask('Owner name: ');
  const ownerEmail = await ask('Owner email: ');
  const ownerPhone = await ask('Owner phone (e.g., +13055559876): ');
  const serviceArea = await ask('Service area (e.g., Broward County): ');
  const services = await ask('Services (comma-separated): ');
  const businessHours = await ask('Business hours (e.g., Mon-Fri 8AM-6PM, Sat 9AM-2PM): ');
  const aiName = await ask('AI staff name (default: Alex): ') || 'Alex';
  const timezone = await ask('Timezone (default: America/New_York): ') || 'America/New_York';
  const areaCode = await ask('Preferred area code for phone number (e.g., 954): ');

  console.log('\n--- Provisioning ---\n');

  // 2. Buy a Twilio phone number
  console.log(`[1/4] Buying Twilio number in area code ${areaCode}...`);
  let twilioNumber;
  try {
    // Search for available numbers
    const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&VoiceEnabled=true&Limit=1`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      },
    });
    const searchData = await searchRes.json();

    if (!searchData.available_phone_numbers || searchData.available_phone_numbers.length === 0) {
      console.error('  ✗ No numbers available in area code', areaCode);
      console.log('  Trying nearby area codes...');

      // Try without area code filter
      const fallbackUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/AvailablePhoneNumbers/US/Local.json?VoiceEnabled=true&Limit=1&InRegion=FL`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        },
      });
      const fallbackData = await fallbackRes.json();

      if (!fallbackData.available_phone_numbers || fallbackData.available_phone_numbers.length === 0) {
        throw new Error('No phone numbers available. Check your Twilio account.');
      }
      twilioNumber = fallbackData.available_phone_numbers[0].phone_number;
    } else {
      twilioNumber = searchData.available_phone_numbers[0].phone_number;
    }

    // Buy the number
    const buyUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`;
    const buyRes = await fetch(buyUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `PhoneNumber=${encodeURIComponent(twilioNumber)}`,
    });
    const buyData = await buyRes.json();

    if (buyData.sid) {
      console.log(`  ✓ Purchased ${twilioNumber}`);
    } else {
      throw new Error(buyData.message || 'Failed to purchase number');
    }
  } catch (err) {
    console.error(`  ✗ Twilio error: ${err.message}`);
    console.log('  You can manually enter a number or press Enter to skip:');
    twilioNumber = await ask('  Phone number (e.g., +19545551234): ');
    if (!twilioNumber) {
      console.log('  Skipping phone number. You will need to add one manually.');
    }
  }

  // 3. Create client in Supabase
  console.log('\n[2/4] Creating client in Supabase...');
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .insert({
      name: ownerName,
      business_name: businessName,
      vertical_id: vertical || 'hvac',
      phone: ownerPhone,
      email: ownerEmail,
      twilio_number: twilioNumber || null,
      status: 'pilot',
    })
    .select()
    .single();

  if (clientError) {
    console.error('  ✗ Failed to create client:', clientError.message);
    rl.close();
    return;
  }
  console.log(`  ✓ Client ID: ${client.id}`);

  // 4. Create client config
  console.log('\n[3/4] Creating client config...');

  // Parse services into JSON array
  const servicesArray = services.split(',').map(s => s.trim()).filter(Boolean);

  // Parse business hours into a simple JSONB structure
  // Store as string for now — can be enhanced later
  const hoursObj = parseBusinessHours(businessHours);

  const { error: configError } = await supabase
    .from('client_config')
    .insert({
      client_id: client.id,
      vertical_id: vertical || 'hvac',
      business_name: businessName,
      services: servicesArray,
      service_area: serviceArea,
      business_hours: hoursObj,
      ai_name: aiName,
      owner_email: ownerEmail,
      timezone: timezone,
      languages: ['en', 'es'], // Default bilingual
    });

  if (configError) {
    console.error('  ✗ Failed to create config:', configError.message);
  } else {
    console.log('  ✓ Config saved');
  }

  // 5. Import number into Vapi
  if (twilioNumber) {
    console.log('\n[4/4] Importing number into Vapi...');
    try {
      const vapiRes = await fetch('https://api.vapi.ai/phone-number', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'twilio',
          number: twilioNumber,
          twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
          twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
          serverUrl: `${process.env.SERVER_URL}/webhook/vapi`,
          // No assistantId — we use server URL mode so our webhook routes dynamically
        }),
      });

      const vapiData = await vapiRes.json();
      if (vapiRes.ok) {
        console.log('  ✓ Phone number imported into Vapi (Server URL mode)');
      } else {
        console.warn('  ⚠ Vapi import issue:', vapiData.message || JSON.stringify(vapiData));
        console.log('  You may need to import this number manually in the Vapi dashboard.');
      }
    } catch (vapiErr) {
      console.warn('  ⚠ Vapi error:', vapiErr.message);
      console.log('  Import the number manually in Vapi dashboard → Phone Numbers → Import');
    }
  } else {
    console.log('\n[4/4] Skipping Vapi import (no phone number)');
  }

  // Clear the client cache so the new client is picked up immediately
  clearCache();

  // Summary
  console.log('\n========================================');
  console.log('  Client Onboarded Successfully!');
  console.log('========================================');
  console.log(`  Business:    ${businessName}`);
  console.log(`  Owner:       ${ownerName} (${ownerEmail})`);
  console.log(`  Vertical:    ${vertical || 'hvac'}`);
  console.log(`  Phone:       ${twilioNumber || 'Not assigned'}`);
  console.log(`  Client ID:   ${client.id}`);
  console.log(`  Service Area: ${serviceArea}`);
  console.log(`  AI Name:     ${aiName}`);
  console.log(`  Timezone:    ${timezone}`);
  console.log('');
  if (twilioNumber) {
    console.log(`  Test it: Call ${twilioNumber}`);
    console.log(`  Alex should say: "Thanks for calling ${businessName}..."`);
  }
  console.log('========================================\n');

  rl.close();
}

/**
 * Parse business hours string into JSONB object
 * Input: "Mon-Fri 8AM-6PM, Sat 9AM-2PM"
 * Output: { mon: {open:"08:00",close:"18:00"}, ... }
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

  // Split by comma for separate day ranges
  const segments = hoursStr.split(',');

  for (const segment of segments) {
    const trimmed = segment.trim();
    // Match patterns like "Mon-Fri 8AM-6PM" or "Sat 9AM-2PM"
    const match = trimmed.match(/(\w+)(?:\s*-\s*(\w+))?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
    if (!match) continue;

    const startDay = dayMap[match[1].toLowerCase()];
    const endDay = match[2] ? dayMap[match[2].toLowerCase()] : startDay;
    const openTime = convertTime(match[3]);
    const closeTime = convertTime(match[4]);

    if (!startDay) continue;

    // Fill in the range
    const startIdx = dayOrder.indexOf(startDay);
    const endIdx = dayOrder.indexOf(endDay || startDay);

    for (let i = startIdx; i <= endIdx; i++) {
      result[dayOrder[i]] = { open: openTime, close: closeTime };
    }
  }

  return result;
}

onboardClient().catch(err => {
  console.error('Onboarding failed:', err);
  rl.close();
});
