// core/server.js
// Express server — routes calls to the correct client dynamically

require('dotenv').config();

// Error monitoring (Sentry)
let Sentry;
if (process.env.SENTRY_DSN) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.1,
    });
    console.log('[Sentry] Error monitoring initialized');
  } catch (e) {
    console.warn('[Sentry] @sentry/node not installed, skipping error monitoring');
  }
}

const express = require('express');
const fs = require('fs');
const path = require('path');
const { handleCallEnd, handleTranscript } = require('./call-handler');
const { bookAppointment, checkAvailability } = require('./booking-handler');
const { getAssistantConfig } = require('./prompt-builder');
const { getClientByPhone } = require('./client-lookup');
const { saveOnboardingData } = require('./onboarding-handler');
const { bookDemo } = require('./sales-handler');
const { transferToJon, lookupClientAccount, checkBillingStatus } = require('./support-handler');
const { syncInvoices } = require('./invoice-handler');
require('./scheduler'); // Initialize cron jobs on server start
const { initFollowUpScheduler } = require('./follow-up-scheduler'); // Initialize follow-up email scheduler

const app = express();

// Allow website frontend to call API endpoints (e.g. Stripe checkout)
const allowedOrigins = new Set([
  'https://runbyai.co',
  'https://www.runbyai.co',
  'https://api.runbyai.co',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Signature');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Simple rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per IP

app.use((req, res, next) => {
  // Skip rate limiting for webhooks (they come from trusted services)
  if (req.path.startsWith('/webhook/')) return next();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  const entry = rateLimitMap.get(ip);
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW;
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  next();
});

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000);

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

  // ── Diagnostic logging ──
  console.log(`\n========== [Vapi Webhook] ==========`);
  console.log(`[Vapi Webhook] Event type: ${eventType}`);
  console.log(`[Vapi Webhook] Top-level keys: ${Object.keys(event).join(', ')}`);
  if (event.message) console.log(`[Vapi Webhook] message keys: ${Object.keys(event.message).join(', ')}`);
  const phone = extractPhoneNumber(event);
  console.log(`[Vapi Webhook] Extracted phone: ${phone || 'NONE'}`);
  console.log(`====================================\n`);

  // Store for diagnostic endpoint
  lastWebhookPayload = {
    received_at: new Date().toISOString(),
    event_type: eventType,
    top_level_keys: Object.keys(event),
    phone_extracted: phone,
    raw_body: event,
  };

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

        // Check if the caller is already an existing client
        const callerNumber = event.message?.call?.customer?.number
          || event.call?.customer?.number
          || event.customer?.number
          || null;

        if (callerNumber) {
          const existingClient = await getClientByPhone(callerNumber);
          if (existingClient && existingClient.client?.status === 'active') {
            console.log(`[Vapi] Caller ${callerNumber} is already an active client: ${existingClient.client.business_name}`);
            // Return a custom assistant that tells them they're already set up
            const alreadyOnboardedPrompt = `You are a friendly RunBy assistant. The caller is already an active RunBy client. Their business is "${existingClient.client.business_name}". Let them know they're already set up and their AI staff is active on ${existingClient.client.twilio_number || 'their dedicated number'}. If they need help with their account, ask them to email jonathan@runbyai.co or call their dedicated RunBy number to test their AI. If they want to onboard a DIFFERENT business, proceed with the normal onboarding flow by collecting the new business details.`;
            res.json({
              assistant: {
                model: {
                  provider: 'anthropic',
                  model: 'claude-sonnet-4-5-20250929',
                  systemPrompt: alreadyOnboardedPrompt,
                  temperature: 0.3,
                },
                voice: { provider: 'vapi', voiceId: 'Emma' },
                firstMessage: `Hi there! I see you're already set up with RunBy for ${existingClient.client.business_name}. Are you looking to onboard a different business, or did you need help with your existing account?`,
              },
            });
            return;
          }
        }

        const onboardingAssistantId = process.env.VAPI_ONBOARDING_ASSISTANT_ID;
        if (onboardingAssistantId) {
          res.json({ assistantId: onboardingAssistantId });
        } else {
          console.error('[Vapi] VAPI_ONBOARDING_ASSISTANT_ID not set in .env');
          res.json({ error: 'Onboarding assistant not configured' });
        }
        return;
      }

      // Check if this is the sales/support phone number
      const salesPhone = process.env.VAPI_SALES_PHONE_NUMBER;
      if (salesPhone && phoneNumber === salesPhone) {
        console.log('[Vapi] Routing to sales/support assistant');

        const salesAssistantId = process.env.VAPI_SALES_ASSISTANT_ID;
        if (!salesAssistantId || salesAssistantId.includes('xxxx') || salesAssistantId === 'your-sales-assistant-id-here') {
          console.error('[Vapi] VAPI_SALES_ASSISTANT_ID not set in .env');
          res.json({ error: 'Sales assistant not configured' });
          return;
        }

        // Extract the caller's phone number to check if they're an existing client
        const callerNumber = event.message?.call?.customer?.number
          || event.call?.customer?.number
          || event.customer?.number
          || null;

        let callerContext = 'new_prospect';
        let overrideFirstMessage = "Hey there, thanks for calling RunBy! We help service businesses stop losing revenue and get their time back with AI-powered staff. Who am I speaking with today?";

        if (callerNumber) {
          const existingClient = await getClientByPhone(callerNumber);
          if (existingClient && existingClient.client?.status === 'active') {
            const clientName = existingClient.client.name || '';
            const businessName = existingClient.client.business_name || '';
            callerContext = `existing_client:${clientName}:${businessName}`;
            overrideFirstMessage = clientName
              ? `Hi ${clientName}! Thanks for calling RunBy. I can see you're calling from ${businessName}. How can I help you today?`
              : `Hi there! Thanks for calling RunBy. I can see you're calling from ${businessName}. How can I help you today?`;
            console.log(`[Vapi] Caller is existing client: ${businessName} (${callerNumber})`);
          }
        }

        // Load the sales/support prompt and inject caller context
        let salesPrompt;
        try {
          salesPrompt = fs.readFileSync(path.join(__dirname, '..', 'verticals', 'sales', 'prompt.md'), 'utf8');
          const objectionsPlaybook = fs.readFileSync(path.join(__dirname, '..', 'verticals', 'sales', 'objections.md'), 'utf8');
          salesPrompt = salesPrompt + '\n\n---\n\n' + objectionsPlaybook;
          salesPrompt = salesPrompt.replace(/\{\{caller_context\}\}/g, callerContext);
        } catch (e) {
          console.error('[Vapi] Failed to load sales prompt:', e.message);
          // Fallback: just use the assistant without overrides
          res.json({ assistantId: salesAssistantId });
          return;
        }

        res.json({
          assistantId: salesAssistantId,
          assistantOverrides: {
            model: {
              systemPrompt: salesPrompt,
            },
            firstMessage: overrideFirstMessage,
          },
        });
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
    // Route onboarding/sales calls to the RunBy internal client
    // ============================================
    if (eventType === 'end-of-call-report' || eventType === 'call.ended' || eventType === 'call_ended') {
      const phoneNumber = extractPhoneNumber(event);
      const onboardingPhone = process.env.VAPI_ONBOARDING_PHONE_NUMBER;
      const salesPhone = process.env.VAPI_SALES_PHONE_NUMBER;

      let clientData = null;
      let agentType = 'client'; // default

      if (onboardingPhone && phoneNumber === onboardingPhone) {
        // Onboarding call — use RunBy internal client
        agentType = 'onboarding';
        clientData = {
          client: {
            id: '00000000-0000-0000-0000-000000000001',
            business_name: 'RunBy AI',
            vertical_id: 'internal',
            status: 'active',
          },
          config: { business_name: 'RunBy AI' },
        };
        console.log('[Vapi] End-of-call: onboarding agent');
      } else if (salesPhone && phoneNumber === salesPhone) {
        // Sales call — use RunBy internal client
        agentType = 'sales';
        clientData = {
          client: {
            id: '00000000-0000-0000-0000-000000000001',
            business_name: 'RunBy AI',
            vertical_id: 'internal',
            status: 'active',
          },
          config: { business_name: 'RunBy AI' },
        };
        console.log('[Vapi] End-of-call: sales agent');
      } else {
        // Regular client call
        clientData = phoneNumber ? await getClientByPhone(phoneNumber) : null;
      }

      await handleCallEnd(event, clientData, agentType);
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

    case 'transfer_to_jon':
      return await transferToJon(args.reason, {
        caller_name: args.caller_name,
        caller_phone: args.caller_phone,
        caller_email: args.caller_email,
        client_id: clientId,
      });

    case 'lookup_client_account': {
      // Get the caller's phone to look up their account
      const callerPhone = clientData?.client?.phone || clientData?.client?.twilio_number || null;
      return await lookupClientAccount(callerPhone, args.query_type);
    }

    case 'check_billing_status':
      return await checkBillingStatus(clientId, args.include_history || false);

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

// ============================================
// STRIPE CHECKOUT — subscription payments
// ============================================

// Price map: plan → { monthly: price_id, annual: price_id }
// These Stripe Price IDs must be created in your Stripe Dashboard
const STRIPE_PRICES = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || '',
    name: 'RunBy Starter',
  },
  growth: {
    monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL || '',
    name: 'RunBy Growth',
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
    name: 'RunBy Pro',
  },
};

app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      console.error('[Stripe] STRIPE_SECRET_KEY not set');
      return res.status(500).json({ error: 'Payment system not configured. Please call us at (786) 733-2209.' });
    }

    const stripe = require('stripe')(stripeKey);

    const { plan, interval } = req.body;

    if (!plan || !STRIPE_PRICES[plan]) {
      return res.status(400).json({ error: 'Invalid plan selected.' });
    }

    const billing = interval === 'annual' ? 'annual' : 'monthly';
    const priceId = STRIPE_PRICES[plan][billing];

    if (!priceId) {
      console.error(`[Stripe] No price ID configured for ${plan}/${billing}`);
      return res.status(500).json({ error: 'This plan is not yet available for purchase. Please call us at (786) 733-2209.' });
    }

    const websiteUrl = process.env.WEBSITE_URL || 'https://runbyai.co';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      subscription_data: {
        trial_period_days: 14,
        metadata: {
          plan,
          interval: billing,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      phone_number_collection: { enabled: true },
      success_url: `${websiteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${websiteUrl}/pricing`,
      metadata: {
        plan,
        interval: billing,
      },
    });

    console.log(`[Stripe] Checkout session created: ${session.id} (${plan}/${billing})`);
    res.json({ url: session.url });

  } catch (error) {
    console.error('[Stripe] Checkout error:', error.message);
    res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
  }
});

// Stripe webhook for subscription events (payment confirmations, cancellations, etc.)
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    console.error('[Stripe Webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return res.sendStatus(400);
  }

  const stripe = require('stripe')(stripeKey);
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.sendStatus(400);
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const plan = session.metadata?.plan || 'starter';
      const billing = session.metadata?.interval || 'monthly';
      console.log(`[Stripe] New subscription: ${session.customer_email} — Plan: ${plan}/${billing}`);

      try {
        const supabase = require('./supabase');

        // Get full customer details from Stripe (name, address, etc.)
        let customerName = session.customer_details?.name || '';
        const customerEmail = session.customer_email || session.customer_details?.email || '';
        const customerPhone = session.customer_details?.phone || '';

        // If we have a Stripe customer ID, fetch more details
        if (session.customer) {
          try {
            const stripeCustomer = await stripe.customers.retrieve(session.customer);
            if (!customerName && stripeCustomer.name) customerName = stripeCustomer.name;
          } catch (e) {
            console.warn('[Stripe] Could not fetch customer details:', e.message);
          }
        }

        // Check if this email already exists as a client
        const { data: existingClient } = await supabase
          .from('clients')
          .select('id')
          .eq('email', customerEmail)
          .maybeSingle();

        if (existingClient) {
          console.log(`[Stripe] Client already exists for ${customerEmail} (id: ${existingClient.id}), skipping creation`);
          // Update status to active in case they were inactive
          await supabase
            .from('clients')
            .update({ status: 'active' })
            .eq('id', existingClient.id);
          break;
        }

        // Map plan to a default vertical — they'll pick during onboarding
        const verticalId = 'general-contractor';

        // Create the client record
        const { data: newClient, error: clientError } = await supabase
          .from('clients')
          .insert({
            name: customerName || 'New Client',
            business_name: customerName ? `${customerName}'s Business` : 'New Business',
            vertical_id: verticalId,
            phone: customerPhone || null,
            email: customerEmail,
            status: 'onboarding',
          })
          .select()
          .single();

        if (clientError) {
          console.error('[Stripe] Failed to create client in Supabase:', clientError.message);
          break;
        }

        console.log(`[Stripe] Created new client: ${newClient.id} (${customerName || customerEmail})`);

        // Create default client_config
        const { error: configError } = await supabase
          .from('client_config')
          .insert({
            client_id: newClient.id,
            vertical_id: verticalId,
            business_name: newClient.business_name,
            owner_email: customerEmail,
            ai_name: 'Alex',
            timezone: 'America/New_York',
          });

        if (configError) {
          console.error('[Stripe] Failed to create client_config:', configError.message);
        } else {
          console.log(`[Stripe] Created client_config for ${newClient.id}`);
        }

        // Store Stripe IDs as metadata in an alert so we can reference them
        await supabase.from('alerts').insert({
          client_id: newClient.id,
          type: 'new_signup',
          message: `New ${plan} (${billing}) subscriber via Stripe. Customer: ${session.customer}, Subscription: ${session.subscription}`,
          severity: 'info',
        });

        // Send welcome email with onboarding call CTA
        try {
          const sgMail = require('@sendgrid/mail');
          sgMail.setApiKey(process.env.SENDGRID_API_KEY);

          const onboardingPhone = process.env.VAPI_ONBOARDING_PHONE_NUMBER || '+17867332114';
          const onboardingPhoneFormatted = '(786) 733-2114';
          const firstName = customerName ? customerName.split(' ')[0] : 'there';
          const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

          await sgMail.send({
            to: customerEmail,
            from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy' },
            subject: `Welcome to RunBy — Call Now to Set Up Your AI Employee`,
            html: `
              <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0d0d1a; color: #c8c8d8; padding: 40px; border-radius: 12px;">
                <h1 style="color: #ffffff; font-size: 28px; margin-bottom: 8px;">Welcome to RunBy!</h1>
                <p style="color: #8b8b9e; font-size: 14px; margin-bottom: 24px;">Your <strong style="color: #e94560;">${planLabel}</strong> plan is active — 14-day free trial started</p>

                <p style="font-size: 16px;">Hey ${firstName},</p>
                <p style="font-size: 16px; line-height: 1.6;">You're one quick call away from having your AI staff up and running. Our onboarding assistant will walk you through everything — your business details, services, hours, and how you want things handled. It takes about 5-10 minutes.</p>

                <div style="text-align: center; margin: 32px 0;">
                  <a href="tel:${onboardingPhone}" style="display: inline-block; background: #e94560; color: #ffffff; font-size: 18px; font-weight: 700; padding: 16px 40px; border-radius: 8px; text-decoration: none; letter-spacing: 0.02em;">
                    Call Now to Get Set Up
                  </a>
                  <p style="color: #8b8b9e; font-size: 14px; margin-top: 12px;">${onboardingPhoneFormatted} — available 24/7</p>
                </div>

                <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 20px; margin: 24px 0;">
                  <p style="color: #ffffff; font-weight: 600; margin-bottom: 12px; font-size: 15px;">What we'll cover on the call:</p>
                  <p style="margin: 0; line-height: 2; font-size: 14px;">
                    <span style="color: #e94560;">1.</span> Your business name and type<br>
                    <span style="color: #e94560;">2.</span> Services you offer and service area<br>
                    <span style="color: #e94560;">3.</span> Your business hours<br>
                    <span style="color: #e94560;">4.</span> How you want your AI staff to sound
                  </p>
                </div>

                <p style="font-size: 15px; line-height: 1.6;">Once we have your info, we'll configure your AI staff and you'll be live within 48 hours. You can also access your dashboard anytime at <a href="https://app.runbyai.co" style="color: #e94560;">app.runbyai.co</a>.</p>

                <p style="font-size: 15px; line-height: 1.6;">Prefer to talk to a human? No problem — call Jon directly at <a href="tel:+17867332209" style="color: #e94560;">(786) 733-2209</a>.</p>

                <p style="margin-top: 30px; color: #8b8b9e; font-size: 13px;">— The RunBy Team</p>
              </div>
            `,
          });
          console.log(`[Stripe] Onboarding email sent to ${customerEmail}`);
        } catch (emailErr) {
          console.error('[Stripe] Failed to send onboarding email:', emailErr.message);
        }

        // Notify Jon about the new signup
        try {
          const sgMail = require('@sendgrid/mail');
          sgMail.setApiKey(process.env.SENDGRID_API_KEY);

          await sgMail.send({
            to: process.env.OWNER_EMAIL,
            from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy Alerts' },
            subject: `New Signup: ${customerName || customerEmail} — ${plan} plan`,
            html: `
              <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>New Client Signup</h2>
                <p><strong>Name:</strong> ${customerName || 'Not provided'}</p>
                <p><strong>Email:</strong> ${customerEmail}</p>
                <p><strong>Phone:</strong> ${customerPhone || 'Not provided'}</p>
                <p><strong>Plan:</strong> ${plan} (${billing})</p>
                <p><strong>Stripe Customer:</strong> ${session.customer}</p>
                <p><strong>Client ID:</strong> ${newClient.id}</p>
                <p>Schedule their onboarding call ASAP.</p>
              </div>
            `,
          });
        } catch (notifyErr) {
          console.error('[Stripe] Failed to notify owner:', notifyErr.message);
        }

      } catch (err) {
        console.error('[Stripe] Error creating client from checkout:', err.message);
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      console.log(`[Stripe] Subscription updated: ${sub.id} — Status: ${sub.status}`);
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log(`[Stripe] Subscription cancelled: ${sub.id}`);
      try {
        const supabase = require('./supabase');
        // Find client by matching the Stripe customer ID in alerts
        const { data: alert } = await supabase
          .from('alerts')
          .select('client_id')
          .eq('type', 'new_signup')
          .like('message', `%${sub.customer}%`)
          .maybeSingle();

        if (alert?.client_id) {
          await supabase
            .from('clients')
            .update({ status: 'inactive' })
            .eq('id', alert.client_id);
          console.log(`[Stripe] Client ${alert.client_id} set to inactive`);
        }
      } catch (err) {
        console.error('[Stripe] Error deactivating client:', err.message);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`[Stripe] Payment failed: ${invoice.customer_email}`);
      try {
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);

        if (invoice.customer_email) {
          await sgMail.send({
            to: invoice.customer_email,
            from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy' },
            subject: 'RunBy — Payment Failed',
            html: `
              <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px;">
                <h2>Payment Issue</h2>
                <p>We weren't able to process your latest payment for RunBy. Please update your payment method to keep your AI staff running.</p>
                <p><a href="https://app.runbyai.co" style="color: #e94560;">Update Payment Method</a></p>
                <p>Questions? Call us at <a href="tel:+17867332209">(786) 733-2209</a>.</p>
              </div>
            `,
          });
        }

        // Notify Jon
        await sgMail.send({
          to: process.env.OWNER_EMAIL,
          from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy Alerts' },
          subject: `Payment Failed: ${invoice.customer_email}`,
          html: `<p>Payment failed for ${invoice.customer_email}. Stripe customer: ${invoice.customer}. Amount: $${(invoice.amount_due / 100).toFixed(2)}</p>`,
        });
      } catch (err) {
        console.error('[Stripe] Error handling payment failure:', err.message);
      }
      break;
    }
    default:
      console.log(`[Stripe Webhook] Unhandled event: ${event.type}`);
  }

  res.json({ received: true });
});

// Contact form
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, business_type, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'Missing required fields: name, email, subject, message' });
    }

    // Store in Supabase
    try {
      const supabase = require('./supabase');
      await supabase.from('alerts').insert({
        client_id: '00000000-0000-0000-0000-000000000001',
        type: 'contact_form',
        message: JSON.stringify({ name, email, phone, business_type, subject, message }),
        severity: 'info',
      });
    } catch (dbErr) {
      console.error('[Contact] DB error:', dbErr.message);
    }

    // Send email to Jon
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send({
        to: process.env.OWNER_EMAIL,
        from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy Contact' },
        subject: `New Contact: ${subject} — ${name}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
            <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
            <p><strong>Business Type:</strong> ${business_type || 'Not specified'}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <hr>
            <p><strong>Message:</strong></p>
            <p>${message}</p>
          </div>
        `,
        replyTo: email,
      });
    } catch (emailErr) {
      console.error('[Contact] Email error:', emailErr.message);
    }

    // Send auto-reply to the person
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send({
        to: email,
        from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy' },
        subject: `We got your message, ${name.split(' ')[0]}!`,
        html: `
          <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0d0d1a; color: #c8c8d8; padding: 40px; border-radius: 12px;">
            <h1 style="color: #ffffff; font-size: 24px;">Thanks for reaching out!</h1>
            <p style="font-size: 15px; line-height: 1.6;">Hey ${name.split(' ')[0]}, we received your message and will get back to you within 24 hours.</p>
            <p style="font-size: 15px; line-height: 1.6;">In the meantime, feel free to:</p>
            <p style="font-size: 15px; line-height: 1.8;">
              → <a href="tel:+17867332209" style="color: #e94560; text-decoration: none;">Call us at (786) 733-2209</a><br>
              → <a href="https://runbyai.co/how-it-works" style="color: #e94560; text-decoration: none;">See how RunBy works</a><br>
              → <a href="https://runbyai.co/calculator" style="color: #e94560; text-decoration: none;">Calculate your savings</a>
            </p>
            <p style="margin-top: 30px; color: #8b8b9e; font-size: 13px;">— The RunBy Team</p>
          </div>
        `,
      });
    } catch (autoReplyErr) {
      console.error('[Contact] Auto-reply error:', autoReplyErr.message);
    }

    console.log(`[Contact] Form submission from ${name} (${email}) — ${subject}`);
    res.json({ success: true, message: 'Message received. We\'ll be in touch within 24 hours.' });

  } catch (error) {
    console.error('[Contact] Error:', error.message);
    res.status(500).json({ error: 'Something went wrong. Please email jonathan@runbyai.co directly.' });
  }
});

// ROI Calculator lead capture
app.post('/api/calculator-lead', async (req, res) => {
  try {
    const { email, business_name, business_type, calculator_results } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Store lead in Supabase
    try {
      const supabase = require('./supabase');
      await supabase.from('demo_leads').insert({
        name: business_name || '',
        email,
        phone: '',
        business_type: business_type || '',
        source: 'roi_calculator',
        notes: JSON.stringify(calculator_results || {}),
      });
    } catch (dbErr) {
      console.error('[Calculator] DB error:', dbErr.message);
    }

    // Notify Jon
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      const results = calculator_results || {};
      await sgMail.send({
        to: process.env.OWNER_EMAIL,
        from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy Leads' },
        subject: `ROI Calculator Lead: ${business_name || email} (${business_type || 'Unknown'})`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>New ROI Calculator Lead</h2>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Business:</strong> ${business_name || 'Not provided'}</p>
            <p><strong>Type:</strong> ${business_type || 'Not specified'}</p>
            <hr>
            <h3>Their Calculator Results:</h3>
            <p><strong>Monthly Revenue Lost:</strong> $${results.monthly_revenue_lost || 'N/A'}</p>
            <p><strong>Monthly Time Cost:</strong> $${results.monthly_time_cost || 'N/A'}</p>
            <p><strong>Annual Savings with RunBy:</strong> $${results.annual_savings || 'N/A'}</p>
            <p><strong>ROI:</strong> ${results.roi_percent || 'N/A'}%</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[Calculator] Email error:', emailErr.message);
    }

    console.log(`[Calculator] Lead captured: ${email} (${business_type})`);
    res.json({ success: true });

  } catch (error) {
    console.error('[Calculator] Error:', error.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Newsletter signup
app.post('/api/subscribe-newsletter', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
      const supabase = require('./supabase');
      await supabase.from('demo_leads').insert({
        name: '',
        email,
        phone: '',
        business_type: '',
        source: 'newsletter',
        notes: 'Blog newsletter signup',
      });
    } catch (dbErr) {
      console.error('[Newsletter] DB error:', dbErr.message);
    }

    console.log(`[Newsletter] New subscriber: ${email}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Newsletter] Error:', error.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// Referral program
app.post('/api/referral', async (req, res) => {
  try {
    const { referrer_email, referred_name, referred_email, referred_phone, referred_business_type } = req.body;

    if (!referrer_email || !referred_email) {
      return res.status(400).json({ error: 'Referrer email and referred email are required' });
    }

    // Store referral in Supabase
    try {
      const supabase = require('./supabase');
      await supabase.from('demo_leads').insert({
        name: referred_name || '',
        email: referred_email,
        phone: referred_phone || '',
        business_type: referred_business_type || '',
        source: 'referral',
        notes: JSON.stringify({ referrer_email }),
      });
    } catch (dbErr) {
      console.error('[Referral] DB error:', dbErr.message);
    }

    // Notify Jon
    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      await sgMail.send({
        to: process.env.OWNER_EMAIL,
        from: { email: process.env.SENDGRID_FROM_EMAIL, name: 'RunBy Referrals' },
        subject: `New Referral: ${referred_name || referred_email} (from ${referrer_email})`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>New Referral</h2>
            <p><strong>Referred by:</strong> ${referrer_email}</p>
            <p><strong>Referred person:</strong> ${referred_name || 'Not provided'}</p>
            <p><strong>Email:</strong> ${referred_email}</p>
            <p><strong>Phone:</strong> ${referred_phone || 'Not provided'}</p>
            <p><strong>Business Type:</strong> ${referred_business_type || 'Not specified'}</p>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error('[Referral] Email error:', emailErr.message);
    }

    console.log(`[Referral] ${referrer_email} referred ${referred_email}`);
    res.json({ success: true, message: 'Referral submitted! We\'ll reach out to them.' });

  } catch (error) {
    console.error('[Referral] Error:', error.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// ── Diagnostic: test Supabase write ──
app.get('/test/supabase-write', async (req, res) => {
  const supabase = require('./supabase');
  const testClientId = process.env.TEST_CLIENT_ID;

  console.log(`\n[Test] Attempting Supabase write with client_id: ${testClientId}`);
  console.log(`[Test] SUPABASE_URL: ${process.env.SUPABASE_URL}`);

  const { data, error } = await supabase
    .from('interactions')
    .insert({
      client_id: testClientId,
      vertical_id: 'hvac',
      type: 'call',
      direction: 'inbound',
      caller_number: '+10000000000',
      caller_name: 'DIAG_TEST',
      classification: 'test',
      outcome: 'resolved',
      duration_seconds: 0,
      source: 'diagnostic',
    })
    .select()
    .single();

  if (error) {
    console.error('[Test] INSERT FAILED:', JSON.stringify(error));
    return res.json({ success: false, error });
  }

  console.log('[Test] INSERT SUCCESS:', data.id);

  // Clean up
  await supabase.from('interactions').delete().eq('id', data.id);
  console.log('[Test] Cleaned up test row');

  res.json({ success: true, message: 'Supabase write works!', test_id: data.id });
});

// ── Diagnostic: echo last webhook payload ──
let lastWebhookPayload = null;
app.get('/test/last-webhook', (req, res) => {
  if (!lastWebhookPayload) {
    return res.json({ message: 'No webhook received yet. Trigger a call and check again.' });
  }
  res.json({
    received_at: lastWebhookPayload.received_at,
    event_type: lastWebhookPayload.event_type,
    top_level_keys: lastWebhookPayload.top_level_keys,
    phone_extracted: lastWebhookPayload.phone_extracted,
    raw_body: lastWebhookPayload.raw_body,
  });
});

// Initialize follow-up email scheduler
initFollowUpScheduler();

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.message);
  console.error(err.stack);
  if (Sentry) Sentry.captureException(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\nRunBy server listening on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook/vapi`);
  console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL || 'NOT SET'}`);
  console.log(`Mode: Multi-client (routes by phone number)`);
  console.log('');
});
