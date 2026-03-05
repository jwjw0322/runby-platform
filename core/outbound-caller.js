// core/outbound-caller.js
// Makes outbound sales calls using Vapi
// Run: node core/outbound-caller.js              (interactive — enter one number)
// Run: node core/outbound-caller.js --file leads.csv   (batch — call from CSV)

require('dotenv').config();
const fs = require('fs');
const readline = require('readline');

const VAPI_API_URL = 'https://api.vapi.ai/call';
const DELAY_BETWEEN_CALLS_MS = 30000; // 30 seconds between batch calls

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Make a single outbound call via Vapi
 */
async function makeCall({ phone, contact_name, business_name }) {
  const assistantId = process.env.VAPI_SALES_ASSISTANT_ID;

  if (!assistantId || assistantId.includes('xxxx')) {
    throw new Error('VAPI_SALES_ASSISTANT_ID not set in .env. Run: node core/create-sales-assistant.js');
  }

  // Build a personalized first message for outbound
  // The sales prompt already has outbound call instructions — the firstMessage sets the tone
  let firstMessage;
  if (contact_name && business_name) {
    firstMessage = `Hi, is this ${contact_name}? Hey ${contact_name}, this is the RunBy team calling. We help service businesses like ${business_name} handle calls with an AI receptionist. Do you have a couple minutes? I think this could really help your business.`;
  } else if (contact_name) {
    firstMessage = `Hi, is this ${contact_name}? Hey ${contact_name}, this is the RunBy team. We help service businesses handle calls with an AI receptionist so they never miss a customer. Do you have a couple minutes?`;
  } else {
    firstMessage = `Hi there, this is the RunBy team. We help service businesses handle calls with an AI receptionist so they never miss a customer. Who am I speaking with?`;
  }

  const callPayload = {
    assistantId: assistantId,
    assistantOverrides: {
      firstMessage: firstMessage,
    },
    customer: {
      number: phone,
      name: contact_name || undefined,
    },
    phoneNumberId: process.env.VAPI_SALES_PHONE_ID || undefined,
  };

  // If we have a specific phone number to call from
  if (process.env.VAPI_SALES_PHONE_NUMBER) {
    callPayload.phoneNumber = {
      number: process.env.VAPI_SALES_PHONE_NUMBER,
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    };
  }

  console.log(`  Calling ${phone}${contact_name ? ` (${contact_name})` : ''}...`);

  const response = await fetch(VAPI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(callPayload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error(`  ✗ Failed: ${result.message || JSON.stringify(result)}`);
    return { success: false, error: result.message, phone };
  }

  console.log(`  ✓ Call initiated — ID: ${result.id}`);
  return { success: true, callId: result.id, phone };
}

/**
 * Parse a CSV file into an array of lead objects
 * Expected columns: phone, business_name, contact_name (at minimum)
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row');
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const leads = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ''));
    const lead = {};
    headers.forEach((header, idx) => {
      lead[header] = values[idx] || '';
    });

    // Must have a phone number
    if (lead.phone) {
      // Ensure phone starts with +
      if (!lead.phone.startsWith('+')) {
        lead.phone = '+1' + lead.phone.replace(/\D/g, '');
      }
      leads.push(lead);
    }
  }

  return leads;
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== MAIN =====
async function main() {
  console.log('\n========================================');
  console.log('  RunBy — Outbound Sales Caller');
  console.log('========================================\n');

  const args = process.argv.slice(2);
  const fileArgIndex = args.indexOf('--file');

  if (fileArgIndex !== -1 && args[fileArgIndex + 1]) {
    // ===== BATCH MODE =====
    const filePath = args[fileArgIndex + 1];

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      rl.close();
      return;
    }

    const leads = parseCSV(filePath);
    console.log(`Loaded ${leads.length} leads from ${filePath}\n`);

    if (leads.length === 0) {
      console.log('No valid leads found in CSV. Ensure there is a "phone" column.');
      rl.close();
      return;
    }

    // Show preview
    console.log('Preview:');
    leads.slice(0, 5).forEach((lead, i) => {
      console.log(`  ${i + 1}. ${lead.phone} — ${lead.contact_name || 'Unknown'} (${lead.business_name || 'Unknown'})`);
    });
    if (leads.length > 5) console.log(`  ... and ${leads.length - 5} more`);

    const confirm = await ask(`\nReady to call ${leads.length} leads? (yes/no): `);
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Cancelled.');
      rl.close();
      return;
    }

    console.log('\nStarting calls...\n');
    const results = [];

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      console.log(`[${i + 1}/${leads.length}]`);

      const result = await makeCall({
        phone: lead.phone,
        contact_name: lead.contact_name || lead.name || '',
        business_name: lead.business_name || lead.business || '',
      });
      results.push(result);

      // Wait between calls (except the last one)
      if (i < leads.length - 1) {
        console.log(`  Waiting ${DELAY_BETWEEN_CALLS_MS / 1000}s before next call...\n`);
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log('\n========================================');
    console.log('  Batch Complete');
    console.log('========================================');
    console.log(`  Total: ${results.length}`);
    console.log(`  Initiated: ${successful}`);
    console.log(`  Failed: ${failed}`);
    if (failed > 0) {
      console.log('\n  Failed numbers:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`    ${r.phone}: ${r.error}`);
      });
    }
    console.log('========================================\n');

  } else {
    // ===== INTERACTIVE MODE =====
    const phone = await ask('Phone number to call (e.g., +13055551234): ');
    if (!phone) {
      console.log('No phone number provided.');
      rl.close();
      return;
    }

    const contact_name = await ask('Contact name (optional, press Enter to skip): ');
    const business_name = await ask('Business name (optional, press Enter to skip): ');

    console.log('');
    await makeCall({
      phone: phone.startsWith('+') ? phone : '+1' + phone.replace(/\D/g, ''),
      contact_name,
      business_name,
    });
  }

  rl.close();
}

main().catch(err => {
  console.error('Error:', err);
  rl.close();
});
