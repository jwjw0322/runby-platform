// core/sales-handler.js
// Handles book_demo function call from the sales voice assistant
// Saves demo lead to Supabase and notifies admin

require('dotenv').config();
const supabase = require('./supabase');
const { sendDemoNotification } = require('./email-sender');

/**
 * Save a demo booking from the sales assistant
 * Called by Vapi when the sales AI triggers the book_demo tool
 */
async function bookDemo(params) {
  const {
    business_name,
    contact_name,
    contact_email,
    contact_phone,
    business_type,
    num_employees,
    current_pain_points,
    interest_level,
    preferred_demo_time,
    timezone,
    call_direction,
  } = params;

  console.log(`\n[Sales] New demo booking request...`);
  console.log(`  Business: ${business_name}`);
  console.log(`  Contact: ${contact_name} (${contact_email})`);
  console.log(`  Interest: ${interest_level || 'warm'}`);

  // Validate required fields
  const required = ['contact_name', 'contact_email', 'contact_phone', 'business_name', 'preferred_demo_time'];
  const missing = required.filter(field => !params[field]);

  if (missing.length > 0) {
    console.log(`[Sales] Missing fields: ${missing.join(', ')}`);
    return {
      success: false,
      message: `I still need a few details: ${missing.join(', ')}. Could you provide those?`,
    };
  }

  // Insert into demo_leads table
  const { data: lead, error } = await supabase
    .from('demo_leads')
    .insert({
      business_name,
      contact_name,
      contact_email,
      contact_phone,
      business_type: business_type || null,
      num_employees: num_employees || null,
      current_pain_points: current_pain_points || null,
      interest_level: (interest_level || 'warm').toLowerCase(),
      preferred_demo_time: preferred_demo_time || null,
      timezone: timezone || 'America/New_York',
      call_direction: call_direction || 'inbound',
      status: 'pending',
      transcribed_data: params,
    })
    .select()
    .single();

  if (error) {
    console.error('[Sales] Database error:', error.message);
    return {
      success: false,
      message: 'There was a technical issue saving your info. Our team has been notified and will reach out to you directly.',
    };
  }

  console.log(`[Sales] Demo lead saved: ${lead.id}`);

  // Send notification email to admin
  try {
    await sendDemoNotification({
      demo_lead_id: lead.id,
      business_name,
      contact_name,
      contact_email,
      contact_phone,
      business_type,
      num_employees,
      current_pain_points,
      interest_level: interest_level || 'warm',
      preferred_demo_time,
      timezone: timezone || 'America/New_York',
      call_direction: call_direction || 'inbound',
    });
    console.log('[Sales] Admin notification email sent');
  } catch (emailErr) {
    console.error('[Sales] Email notification failed:', emailErr.message);
  }

  return {
    success: true,
    message: `You're all set! I've booked your demo for ${preferred_demo_time}. You'll get a confirmation email at ${contact_email}, and one of our team members will reach out before the meeting.`,
  };
}

module.exports = { bookDemo };
