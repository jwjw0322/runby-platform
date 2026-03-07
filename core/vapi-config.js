// core/vapi-config.js
// Creates or updates a Vapi voice assistant with tool calling for bookings + emails

require('dotenv').config();
const fs = require('fs');

async function createAssistant() {
  const prompt = fs.readFileSync('./verticals/hvac/prompt.md', 'utf8');

  // Generate current date info
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const currentDay = days[now.getDay()];
  const currentTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowDate = tomorrow.toISOString().split('T')[0];

  const filledPrompt = prompt
    .replace(/{{business_name}}/g, 'ABC Heating & Cooling')
    .replace(/{{service_area}}/g, 'Miami-Dade County')
    .replace(/{{services}}/g, 'AC repair, heating repair, maintenance, duct cleaning, new installs')
    .replace(/{{business_hours}}/g, 'Mon-Fri 8AM-6PM, Sat 9AM-2PM')
    .replace(/{{current_date}}/g, currentDate)
    .replace(/{{current_day_of_week}}/g, currentDay)
    .replace(/{{current_time}}/g, currentTime)
    .replace(/{{tomorrow_date}}/g, tomorrowDate);

  const assistantConfig = {
    name: 'RunBy HVAC - ABC Heating',
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
                customer_name: {
                  type: 'string',
                  description: 'Full name of the customer',
                },
                customer_phone: {
                  type: 'string',
                  description: 'Customer phone number',
                },
                customer_email: {
                  type: 'string',
                  description: 'Customer email address',
                },
                customer_address: {
                  type: 'string',
                  description: 'Service address where the technician will go (street, city, state, zip)',
                },
                service_type: {
                  type: 'string',
                  description: 'Type of service needed (e.g., AC repair, heating repair, maintenance, duct cleaning, new install)',
                },
                preferred_date: {
                  type: 'string',
                  description: 'Preferred appointment date in YYYY-MM-DD format',
                },
                preferred_time: {
                  type: 'string',
                  description: 'Preferred appointment time (e.g., 9:00 AM, 2:00 PM)',
                },
                notes: {
                  type: 'string',
                  description: 'Any additional details about the issue or special requests',
                },
              },
              required: ['customer_name', 'customer_phone', 'customer_email', 'customer_address', 'service_type', 'preferred_date', 'preferred_time'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'check_availability',
            description: 'Check available appointment slots for a given date. Call this when a customer asks what times are available before booking.',
            parameters: {
              type: 'object',
              properties: {
                date: {
                  type: 'string',
                  description: 'Date to check in YYYY-MM-DD format',
                },
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
                reason: {
                  type: 'string',
                  description: 'Why the call is being transferred',
                },
                priority: {
                  type: 'string',
                  enum: ['normal', 'urgent', 'emergency'],
                  description: 'Priority level',
                },
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
    firstMessage: 'Thanks for calling ABC Heating and Cooling, this is Alex. How can I help you today?',
    endCallMessage: 'Thanks for calling ABC Heating and Cooling. Have a great day!',
    serverUrl: `${process.env.SERVER_URL}/webhook/vapi`,
    recordingEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
  };

  // Update existing or create new
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  let response;

  if (assistantId && !assistantId.includes('xxxx')) {
    console.log(`Updating existing assistant: ${assistantId}`);
    response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assistantConfig),
    });
  } else {
    console.log('Creating new assistant...');
    response = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assistantConfig),
    });
  }

  const assistant = await response.json();

  if (!response.ok) {
    console.error('API Error:', response.status);
    console.error('Response:', JSON.stringify(assistant, null, 2));
    return;
  }

  console.log('Assistant ID:', assistant.id);
  console.log('Tools configured: book_appointment, check_availability, transfer_call');

  if (!assistantId || assistantId.includes('xxxx')) {
    console.log('\nAdd this to your .env:');
    console.log(`VAPI_ASSISTANT_ID=${assistant.id}`);
  } else {
    console.log('Assistant updated successfully!');
  }

  return assistant;
}

createAssistant().catch(err => console.error('Error:', err));
