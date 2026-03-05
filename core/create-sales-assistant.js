// core/create-sales-assistant.js
// Creates or updates the Vapi sales assistant
// Run: node core/create-sales-assistant.js

require('dotenv').config();
const fs = require('fs');

async function createSalesAssistant() {
  const prompt = fs.readFileSync('./verticals/sales/prompt.md', 'utf8');

  const assistantConfig = {
    name: 'RunBy Sales Representative',
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: prompt,
      temperature: 0.4,  // Slightly higher for more natural sales conversation
      tools: [
        {
          type: 'function',
          function: {
            name: 'book_demo',
            description: 'Book a demo meeting with a prospective client. Call this ONLY after the prospect has expressed interest, you have collected ALL required fields, AND they have confirmed the details.',
            parameters: {
              type: 'object',
              properties: {
                business_name: {
                  type: 'string',
                  description: 'Name of the prospect\'s business',
                },
                contact_name: {
                  type: 'string',
                  description: 'Full name of the person you\'re speaking with',
                },
                contact_email: {
                  type: 'string',
                  description: 'Email address to send the demo invite to',
                },
                contact_phone: {
                  type: 'string',
                  description: 'Phone number of the prospect',
                },
                business_type: {
                  type: 'string',
                  description: 'Type of business (e.g., HVAC, plumbing, electrical, roofing, general contractor)',
                },
                num_employees: {
                  type: 'string',
                  description: 'Approximate number of employees (e.g., "5", "10-20", "50+")',
                },
                current_pain_points: {
                  type: 'string',
                  description: 'What problems they\'re experiencing with call handling (e.g., "missing calls", "no after-hours coverage", "overwhelmed receptionist")',
                },
                interest_level: {
                  type: 'string',
                  description: 'How interested the prospect seems: "hot" (ready to buy), "warm" (interested), or "cold" (just curious)',
                  enum: ['hot', 'warm', 'cold'],
                },
                preferred_demo_time: {
                  type: 'string',
                  description: 'When they want the demo (e.g., "Tuesday at 2pm", "tomorrow morning", "this week afternoon")',
                },
                timezone: {
                  type: 'string',
                  description: 'Prospect timezone in IANA format (e.g., America/New_York, America/Chicago)',
                },
              },
              required: ['contact_name', 'contact_email', 'contact_phone', 'business_name', 'preferred_demo_time'],
            },
          },
        },
      ],
    },
    voice: {
      provider: 'vapi',
      voiceId: 'Mark',  // Male voice — distinct from Emma (client) and Aura (onboarding)
    },
    firstMessage: "Hey there, thanks for calling RunBy! I'm here to tell you about how we can help your business never miss another call. Who am I speaking with today?",
    endCallMessage: "Thanks so much for your time! If you ever want to learn more, just give us a call back. Have a great day!",
    serverUrl: `${process.env.SERVER_URL}/webhook/vapi`,
    recordingEnabled: true,
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 900,  // 15 minutes max
  };

  // Update existing or create new
  const assistantId = process.env.VAPI_SALES_ASSISTANT_ID;
  let response;

  // helper to update .env key/value pairs
  function updateEnv(key, value) {
    const envPath = '.env';
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      if (envContent && !envContent.endsWith('\n')) envContent += '\n';
      envContent += `${key}=${value}` + '\n';
    }
    fs.writeFileSync(envPath, envContent);
  }

  if (assistantId && !assistantId.includes('xxxx')) {
    console.log(`Updating existing sales assistant: ${assistantId}`);
    response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(assistantConfig),
    });
  } else {
    console.log('Creating new sales assistant...');
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
  console.log('  Sales Assistant Created!');
  console.log('========================================');
  console.log(`  Assistant ID: ${assistant.id}`);
  console.log(`  Tool: book_demo`);
  console.log(`  Voice: Mark`);
  console.log(`  Max duration: 15 minutes`);

  if (!assistantId || assistantId.includes('xxxx')) {
    console.log('\n  Add this to your .env:');
    console.log(`  VAPI_SALES_ASSISTANT_ID=${assistant.id}`);

    // automatically update .env file for convenience
    try {
      updateEnv('VAPI_SALES_ASSISTANT_ID', assistant.id);
      console.log('\n  .env updated with new assistant ID');
    } catch (err) {
      console.error('Failed to write to .env:', err);
    }
  } else {
    console.log('\n  Assistant updated successfully!');
  }

  console.log('\n  Next steps:');
  console.log('  1. Add the assistant ID to your .env');
  console.log('  2. Buy a Twilio number for sales (or use an existing one)');
  console.log('  3. Import that number into Vapi with Server URL mode');
  console.log('  4. Add VAPI_SALES_PHONE_NUMBER=+1XXXXXXXXXX to your .env');
  console.log('  5. Restart your server');
  console.log('  6. For outbound calls: node core/outbound-caller.js');
  console.log('========================================\n');

  return assistant;
}

createSalesAssistant().catch(err => console.error('Error:', err));
