// core/prompt-builder.js
// Builds the AI prompt with live date/time and client-specific config

const fs = require('fs');
const path = require('path');

/**
 * Build the prompt with current date/time and client config
 * Config comes from client-lookup.js (loaded from Supabase per-client)
 */
function buildPrompt(config = {}) {
  // Load the prompt template for this vertical (default: hvac)
  const vertical = config.vertical_id || 'hvac';
  const promptPath = path.join(__dirname, '..', 'verticals', vertical, 'prompt.md');
  const prompt = fs.readFileSync(promptPath, 'utf8');

  // Generate current date info in the client's timezone
  const tz = config.timezone || 'America/New_York';
  const now = new Date();
  const localized = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const currentDate = localized.toISOString().split('T')[0];
  const currentDay = days[localized.getDay()];
  const currentTime = localized.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const tomorrow = new Date(localized);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toISOString().split('T')[0];

  const aiName = config.ai_name || 'Alex';

  const filledPrompt = prompt
    .replace(/{{business_name}}/g, config.business_name || 'our company')
    .replace(/{{service_area}}/g, config.service_area || '')
    .replace(/{{services}}/g, config.services || '')
    .replace(/{{business_hours}}/g, config.business_hours || '')
    .replace(/{{current_date}}/g, currentDate)
    .replace(/{{current_day_of_week}}/g, currentDay)
    .replace(/{{current_time}}/g, currentTime)
    .replace(/{{tomorrow_date}}/g, tomorrowDate)
    .replace(/Alex/g, aiName); // Replace AI name if different

  console.log(`[Prompt] Built for "${config.business_name}" | ${currentDate} (${currentDay}) ${currentTime} | AI: ${aiName}`);
  return filledPrompt;
}

/**
 * Get the full assistant config with tools
 * Used for assistant-request responses when a call comes in
 */
function getAssistantConfig(config = {}) {
  const filledPrompt = buildPrompt(config);
  const aiName = config.ai_name || 'Alex';

  return {
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: filledPrompt,
      temperature: 0.3,
      tools: [
        {
          type: 'function',
          function: {
            name: 'book_appointment',
            description: 'Book a service appointment for the customer. Only call this AFTER you have collected their name, phone, email, service address, service type, and preferred date/time.',
            parameters: {
              type: 'object',
              properties: {
                customer_name: { type: 'string', description: 'Full name of the customer' },
                customer_phone: { type: 'string', description: 'Customer phone number' },
                customer_email: { type: 'string', description: 'Customer email address' },
                customer_address: { type: 'string', description: 'Service address (street, city, state, zip)' },
                service_type: { type: 'string', description: 'Type of service needed' },
                preferred_date: { type: 'string', description: 'Appointment date in YYYY-MM-DD format' },
                preferred_time: { type: 'string', description: 'Appointment time (e.g., 9:00 AM)' },
                notes: { type: 'string', description: 'Additional details or special requests' },
              },
              required: ['customer_name', 'customer_phone', 'customer_email', 'customer_address', 'service_type', 'preferred_date', 'preferred_time'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'check_availability',
            description: 'Check available appointment slots for a given date.',
            parameters: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Date to check in YYYY-MM-DD format' },
              },
              required: ['date'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'transfer_call',
            description: 'Transfer the call to a human. Use for emergencies, angry customers, or when customer asks to speak to someone.',
            parameters: {
              type: 'object',
              properties: {
                reason: { type: 'string', description: 'Why the call is being transferred' },
                priority: { type: 'string', enum: ['normal', 'urgent', 'emergency'], description: 'Priority level' },
              },
              required: ['reason'],
            },
          },
        },
      ],
    },
    voice: {
      provider: 'vapi',
      voiceId: 'Emma',
    },
    firstMessage: `Thanks for calling ${config.business_name || 'our company'}, this is ${aiName}. How can I help you today?`,
    endCallMessage: `Thanks for calling ${config.business_name || 'our company'}. Have a great day!`,
    serverUrl: `${process.env.SERVER_URL}/webhook/vapi`,
    recordingEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
  };
}

module.exports = { buildPrompt, getAssistantConfig };
