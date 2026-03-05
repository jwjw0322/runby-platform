// core/server.js
// Express server — routes calls to the correct client dynamically

require('dotenv').config();
const express = require('express');
const { handleCallEnd, handleTranscript } = require('./call-handler');
const { bookAppointment, checkAvailability } = require('./booking-handler');
const { getAssistantConfig } = require('./prompt-builder');
const { getClientByPhone } = require('./client-lookup');
const { saveOnboardingData } = require('./onboarding-handler');
const { bookDemo } = require('./sales-handler');
const { syncInvoices } = require('./invoice-handler');
require('./scheduler'); // Initialize cron jobs on server start
const { initFollowUpScheduler } = require('./follow-up-scheduler'); // Initialize follow-up email scheduler

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'RunBy Platform running', timestamp: new Date().toISOString() });
});

/**
 * Extract the phone number that was called from a Vapi event
 * Vapi puts this in different places depending on the event type
 */
function extractPhoneNumber(event) {
  return event.message?.call?.phoneNumber?.number
    || event.call?.phoneNumber?.number
    || event.phoneNumber?.number
    || event.message?.phoneNumber?.number
    || event.call?.phoneNumberId
    || null;
}

// Vapi webhook — receives events during and after calls
app.post('/webhook/vapi', async (req, res) => {
  const event = req.body;
  const eventType = event.type || event.message?.type || 'unknown';

  console.log(`\n[Vapi Webhook] Event type: ${eventType}`);

  try {
    // ============================================
    // ASSISTANT REQUEST — build client-specific config
    // ============================================
    if (eventType === 'assistant-request') {
      const phoneNumber = extractPhoneNumber(event);
      console.log(`[Vapi] Assistant request for phone: ${phoneNumber}`);

      // Check if this is the onboarding phone number
      const onboardingPhone = process.env.VAPI_ONBOARDING_PHONE_NUMBER;
      if (onboardingPhone && phoneNumber === onboardingPhone) {
        console.log('[Vapi] Routing to onboarding assistant');
        const onboardingAssistantId = process.env.VAPI_ONBOARDING_ASSISTANT_ID;
        if (onboardingAssistantId) {
          res.json({ assistantId: onboardingAssistantId });
        } else {
          console.error('[Vapi] VAPI_ONBOARDING_ASSISTANT_ID not set in .env');
          res.json({ error: 'Onboarding assistant not configured' });
        }
        return;
      }

      // Check if this is the sales phone number
      const salesPhone = process.env.VAPI_SALES_PHONE_NUMBER;
      if (salesPhone && phoneNumber === salesPhone) {
        console.log('[Vapi] Routing to sales assistant');
        const salesAssistantId = process.env.VAPI_SALES_ASSISTANT_ID;
        if (salesAssistantId) {
          res.json({ assistantId: salesAssistantId });
        } else {
          console.error('[Vapi] VAPI_SALES_ASSISTANT_ID not set in .env');
          res.json({ error: 'Sales assistant not configured' });
        }
        return;
      }

      let clientData = null;
      if (phoneNumber) {
        clientData = await getClientByPhone(phoneNumber);
      }

      if (clientData) {
        // Build config personalized for this client
        const assistantConfig = getAssistantConfig(clientData.config);
        res.json({ assistant: assistantConfig });
      } else {
        // Fallback to default config (backward compatible with TEST_CLIENT_ID)
        console.log('[Vapi] No client found for phone, using default config');
        const assistantConfig = getAssistantConfig();
        res.json({ assistant: assistantConfig });
      }
      return;
    }

    // ============================================
    // FUNCTION CALLS — route to handlers with client context
    // ============================================
    if (eventType === 'function-call' || eventType === 'tool-calls') {
      // Look up the client for this call
      const phoneNumber = extractPhoneNumber(event);
      const clientData = phoneNumber ? await getClientByPhone(phoneNumber) : null;

      const functionCall = event.message?.functionCall || event.functionCall;
      const toolCalls = event.message?.toolCallList || event.toolCallList || event.toolCalls;

      if (functionCall) {
        const result = await handleFunctionCall(functionCall, clientData);
        console.log(`[Vapi] Function result:`, JSON.stringify(result));
        res.json({ result: JSON.stringify(result) });
        return;
      }

      if (toolCalls && toolCalls.length > 0) {
        const results = [];
        for (const toolCall of toolCalls) {
          const fn = toolCall.function || toolCall;
          const result = await handleFunctionCall(fn, clientData);
          results.push({
            toolCallId: toolCall.id,
            result: JSON.stringify(result),
          });
        }
        res.json({ results });
        return;
      }

      res.json({ result: 'no function found' });
      return;
    }

    // ============================================
    // END OF CALL — log with correct client_id
    // ============================================
    if (eventType === 'end-of-call-report' || eventType === 'call.ended' || eventType === 'call_ended') {
      const phoneNumber = extractPhoneNumber(event);
      const clientData = phoneNumber ? await getClientByPhone(phoneNumber) : null;
      await handleCallEnd(event, clientData);
    }

    // ============================================
    // LIVE TRANSCRIPT
    // ============================================
    else if (eventType === 'transcript' || eventType === 'conversation-update') {
      await handleTranscript(event);
    }

    // ============================================
    // OTHER EVENTS
    // ============================================
    else {
      console.log('[Vapi] Other event:', eventType);
    }

    res.json({ status: 'ok' });
  } catch (error) {
    console.error('[Vapi Webhook Error]', error.message);
    console.error(error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Route a function call to the correct handler, passing client context
 */
async function handleFunctionCall(functionCall, clientData) {
  const name = functionCall.name;
  const args = typeof functionCall.parameters === 'string'
    ? JSON.parse(functionCall.parameters)
    : functionCall.parameters || functionCall.arguments || {};

  // Get client_id — from lookup or fallback to TEST_CLIENT_ID
  const clientId = clientData?.client?.id || process.env.TEST_CLIENT_ID;
  const clientConfig = clientData?.config || {};

  console.log(`\n[Function Call] ${name} for client: ${clientConfig.business_name || clientId}`);
  console.log(`[Function Call] Args:`, JSON.stringify(args, null, 2));

  switch (name) {
    case 'book_appointment':
      return await bookAppointment(args, clientId, clientConfig);

    case 'check_availability':
      return await checkAvailability(args, clientId);

    case 'transfer_call':
      console.log(`[Transfer] Reason: ${args.reason}, Priority: ${args.priority || 'normal'}`);
      return {
        success: true,
        message: `Transferring call. Reason: ${args.reason}. Please let the customer know someone will be with them shortly.`,
      };

    case 'save_onboarding_data':
      return await saveOnboardingData(args);

    case 'book_demo':
      return await bookDemo(args);

    default:
      console.log(`[Function Call] Unknown function: ${name}`);
      return { success: false, message: `Unknown function: ${name}` };
  }
}

// Twilio status callback
app.post('/webhook/twilio/status', (req, res) => {
  console.log(`[Twilio] Call ${req.body.CallSid} status: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// Invoice sync webhook — receives invoices from QuickBooks/FreshBooks
app.post('/webhook/invoice-sync', async (req, res) => {
  try {
    const secret = req.headers['x-webhook-secret'];
    if (secret !== process.env.INVOICE_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { client_id, invoices } = req.body;
    if (!client_id || !invoices) {
      return res.status(400).json({ error: 'Missing client_id or invoices' });
    }
    const result = await syncInvoices(client_id, invoices);
    console.log(`[Invoice Sync] Synced ${result.synced} invoices for client ${client_id}`);
    res.json(result);
  } catch (error) {
    console.error('[Invoice Sync Error]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark a booking as completed (triggers follow-up email in 3 days)
app.post('/api/bookings/:id/complete', async (req, res) => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { id } = req.params;
    const { data, error } = await supabase
      .from('bookings')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    console.log(`[Booking] Marked ${id} as completed`);
    res.json({ success: true, booking: data });
  } catch (error) {
    console.error('[Booking Complete Error]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Initialize follow-up email scheduler
initFollowUpScheduler();

app.listen(PORT, () => {
  console.log(`\nRunBy server listening on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook/vapi`);
  console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL || 'NOT SET'}`);
  console.log(`Mode: Multi-client (routes by phone number)`);
  console.log('');
});
