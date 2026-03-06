// core/create-onboarding-assistant.js
// Creates or updates the Vapi onboarding assistant
// Run: node core/create-onboarding-assistant.js

require('dotenv').config();
const fs = require('fs');

async function createOnboardingAssistant() {
  const prompt = fs.readFileSync('./verticals/onboarding/prompt.md', 'utf8');

  const assistantConfig = {
    name: 'RunBy Onboarding Assistant',
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: prompt,
      temperature: 0.3,
      tools: [
        {
          type: 'function',
          function: {
            name: 'save_onboarding_data',
            description: 'Save the collected onboarding information for a new client. Call this ONLY after you have collected ALL required fields AND the caller has confirmed everything is correct.',
            parameters: {
              type: 'object',
              properties: {
                business_name: {
                  type: 'string',
                  description: 'Name of the business (e.g., "Miami Cool Air")',
                },
                vertical_id: {
                  type: 'string',
                  description: 'Business vertical: hvac, plumbing, electrical, roofing, or general',
                },
                owner_name: {
                  type: 'string',
                  description: 'Full name of the business owner',
                },
                owner_email: {
                  type: 'string',
                  description: 'Business owner email address',
                },
                owner_phone: {
                  type: 'string',
                  description: 'Business owner phone number (e.g., +13055559876)',
                },
                service_area: {
                  type: 'string',
                  description: 'Geographic area serviced (e.g., "Miami-Dade County", "Greater Los Angeles")',
                },
                services: {
                  type: 'string',
                  description: 'Comma-separated list of services offered (e.g., "AC repair, heating repair, maintenance, duct cleaning, new installs")',
                },
                business_hours: {
                  type: 'string',
                  description: 'Business hours (e.g., "Mon-Fri 8AM-6PM, Sat 9AM-2PM")',
                },
                ai_name: {
                  type: 'string',
                  description: 'Preferred name for the AI receptionist (default: Alex)',
                },
                timezone: {
                  type: 'string',
                  description: 'Timezone in IANA format (e.g., America/New_York, America/Chicago, America/Denver, America/Los_Angeles)',
                },
                preferred_area_code: {
                  type: 'string',
                  description: 'Preferred area code for the new phone number (e.g., "305", "954")',
                },
              },
              required: ['business_name', 'vertical_id', 'owner_name', 'owner_email', 'owner_phone', 'service_area', 'services', 'business_hours'],
            },
          },
        },
      ],
    },
    voice: {
      provider: 'vapi',
      voiceId: 'Emma',
    },
    firstMessage: "Hi there! Thanks for calling RunBy. I'm here to help you get your AI receptionist set up. It'll take about five to ten minutes — I just need to grab some details about your business. Sound good?",
    endCallMessage: "Thanks so much for signing up with RunBy! You should receive a confirmation email shortly. Our team will review everything and get you all set up. Have a great day!",
    serverUrl: `${process.env.SERVER_URL}/webhook/vapi`,
    recordingEnabled: true,
    silenceTimeoutSeconds: 45,   // Longer timeout — business owners may need to think
    maxDurationSeconds: 900,     // 15 minutes max
  };

  // Update existing or create new
  const assistantId = process.env.VAPI_ONBOARDING_ASSISTANT_ID;
  let response;

  if (assistantId && !assistantId.includes('xxxx')) {
    console.log(`Updating existing onboarding assistant: ${assistantId}`);
    response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assistantConfig),
    });
  } else {
    console.log('Creating new onboarding assistant...');
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

  console.log('\n========================================');
  console.log('  Onboarding Assistant Created!');
  console.log('========================================');
  console.log(`  Assistant ID: ${assistant.id}`);
  console.log(`  Tool: save_onboarding_data`);
  console.log(`  Voice: Emma`);
  console.log(`  Max duration: 15 minutes`);

  if (!assistantId || assistantId.includes('xxxx')) {
    console.log('\n  Add this to your .env:');
    console.log(`  VAPI_ONBOARDING_ASSISTANT_ID=${assistant.id}`);
  } else {
    console.log('\n  Assistant updated successfully!');
  }

  console.log('\n  Next steps:');
  console.log('  1. Add the assistant ID to your .env');
  console.log('  2. Buy a Twilio number for onboarding (or use an existing one)');
  console.log('  3. Import that number into Vapi with Server URL mode');
  console.log('  4. Add VAPI_ONBOARDING_PHONE_NUMBER=+1XXXXXXXXXX to your .env');
  console.log('  5. Restart your server');
  console.log('========================================\n');

  return assistant;
}

createOnboardingAssistant().catch(err => console.error('Error:', err));
