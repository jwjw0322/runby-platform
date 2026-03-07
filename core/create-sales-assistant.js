// core/create-sales-assistant.js
// Creates or updates the Vapi sales assistant
// Run: node core/create-sales-assistant.js

require('dotenv').config();
const fs = require('fs');

async function createSalesAssistant() {
  const prompt = fs.readFileSync('./verticals/sales/prompt.md', 'utf8');
  const objections = fs.readFileSync('./verticals/sales/objections.md', 'utf8');
  const fullPrompt = prompt + '\n\n---\n\n' + objections;

  const assistantConfig = {
    name: 'RunBy Sales & Support Representative',
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: fullPrompt,
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
        {
          type: 'function',
          function: {
            name: 'transfer_to_jon',
            description: 'Transfer the call to Jon (the founder) for a live demo, support escalation, or when the caller requests a human. Use in sales mode for hot leads wanting a live walkthrough, and in support mode for complex issues or complaints.',
            parameters: {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  description: 'Why the call is being transferred (e.g., "Hot prospect wants live demo", "Billing dispute", "Technical issue", "Caller requested human")',
                },
                caller_name: {
                  type: 'string',
                  description: 'Name of the caller if known',
                },
                caller_phone: {
                  type: 'string',
                  description: 'Phone number of the caller',
                },
                caller_email: {
                  type: 'string',
                  description: 'Email address of the caller if known',
                },
              },
              required: ['reason'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'lookup_client_account',
            description: 'Look up account details for an existing RunBy client. Use in support mode to retrieve account info, recent bookings, service settings, or contact details. Only works for existing clients.',
            parameters: {
              type: 'object',
              properties: {
                query_type: {
                  type: 'string',
                  description: 'What information to retrieve',
                  enum: ['account_summary', 'recent_bookings', 'service_settings', 'contact_info'],
                },
              },
              required: ['query_type'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'check_billing_status',
            description: 'Check billing and invoice status for an existing RunBy client. Use when the caller asks about payments, invoices, balances, or charges. Only works for existing clients.',
            parameters: {
              type: 'object',
              properties: {
                include_history: {
                  type: 'boolean',
                  description: 'Whether to include recent invoice history (default: false). Set to true when the caller asks about past invoices or payment history.',
                },
              },
            },
          },
        },
      ],
    },
    voice: {
      provider: 'vapi',
      voiceId: 'Leo',  // Supported male voice in Vapi's current voice list
    },
    firstMessage: "Hey there, thanks for calling RunBy! We help service businesses stop losing revenue and get their time back with AI-powered staff. Who am I speaking with today?",
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
  console.log('  Sales & Support Assistant Created!');
  console.log('========================================');
  console.log(`  Assistant ID: ${assistant.id}`);
  console.log(`  Tools: book_demo, transfer_to_jon, lookup_client_account, check_billing_status`);
  console.log(`  Voice: Leo`);
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
