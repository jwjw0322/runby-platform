// core/support-handler.js
// Handles customer support function calls for existing RunBy clients
// Used when an existing client calls the sales/support line

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Look up a client's account details by phone number
 * Returns different data depending on queryType
 */
async function lookupClientAccount(callerPhone, queryType) {
  console.log(`[Support] Looking up account for ${callerPhone}, query: ${queryType}`);

  // Find the client by their phone (owner phone, twilio number, or client_config phone)
  let client = null;

  // Try by twilio_number first
  const { data: byTwilio } = await supabase
    .from('clients')
    .select(`
      id, name, business_name, vertical_id, phone, email, twilio_number, status, created_at,
      client_config (
        owner_email, timezone, ai_name, services, service_area, business_hours
      )
    `)
    .or(`phone.eq.${callerPhone},twilio_number.eq.${callerPhone}`)
    .limit(1)
    .single();

  if (byTwilio) {
    client = byTwilio;
  } else {
    // Try matching on client_config owner phone or general lookup
    const { data: allClients } = await supabase
      .from('clients')
      .select(`
        id, name, business_name, vertical_id, phone, email, twilio_number, status, created_at,
        client_config (
          owner_email, timezone, ai_name, services, service_area, business_hours
        )
      `)
      .in('status', ['active', 'pilot']);

    if (allClients) {
      client = allClients.find(c => c.phone === callerPhone || c.email?.includes(callerPhone));
    }
  }

  if (!client) {
    return {
      success: false,
      message: "I wasn't able to find your account. Could you tell me your business name so I can look you up?",
    };
  }

  const config = Array.isArray(client.client_config) ? client.client_config[0] : client.client_config;

  switch (queryType) {
    case 'account_summary': {
      // Get recent call count
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: recentCalls } = await supabase
        .from('interactions')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('created_at', since);

      const { count: totalBookings } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .gte('created_at', since);

      return {
        success: true,
        message: `Here's the account summary for ${client.business_name}:
- Status: ${client.status}
- AI Receptionist: ${config?.ai_name || 'Alex'}
- Vertical: ${client.vertical_id}
- Dedicated Number: ${client.twilio_number || 'Not assigned'}
- Calls this week: ${recentCalls || 0}
- Bookings this week: ${totalBookings || 0}
- Service Area: ${config?.service_area || 'Not set'}
- Member since: ${new Date(client.created_at).toLocaleDateString('en-US')}`,
      };
    }

    case 'recent_bookings': {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('customer_name, service_type, scheduled_date, scheduled_time, status')
        .eq('client_id', client.id)
        .order('scheduled_date', { ascending: false })
        .limit(5);

      if (!bookings || bookings.length === 0) {
        return {
          success: true,
          message: `${client.business_name} doesn't have any recent bookings.`,
        };
      }

      const bookingList = bookings.map(b =>
        `- ${b.scheduled_date} at ${b.scheduled_time}: ${b.service_type} for ${b.customer_name} (${b.status})`
      ).join('\n');

      return {
        success: true,
        message: `Recent bookings for ${client.business_name}:\n${bookingList}`,
      };
    }

    case 'service_settings': {
      const services = Array.isArray(config?.services) ? config.services.join(', ') : (config?.services || 'Not configured');
      return {
        success: true,
        message: `Service settings for ${client.business_name}:
- AI Receptionist Name: ${config?.ai_name || 'Alex'}
- Services Offered: ${services}
- Business Hours: ${config?.business_hours || 'Not set'}
- Service Area: ${config?.service_area || 'Not set'}
- Timezone: ${config?.timezone || 'America/New_York'}`,
      };
    }

    case 'contact_info': {
      return {
        success: true,
        message: `Contact information for ${client.business_name}:
- Owner: ${client.name}
- Email: ${config?.owner_email || client.email || 'Not on file'}
- Phone: ${client.phone || 'Not on file'}
- Dedicated RunBy Number: ${client.twilio_number || 'Not assigned'}`,
      };
    }

    default:
      return {
        success: true,
        message: `${client.business_name} is an active RunBy client. How can I help with their account?`,
      };
  }
}

/**
 * Check billing and invoice status for a client
 */
async function checkBillingStatus(clientId, includeHistory = false) {
  console.log(`[Support] Checking billing for client: ${clientId}`);

  if (!clientId) {
    return {
      success: false,
      message: "I need to look up your account first. Could you tell me your business name?",
    };
  }

  const { data: invoices } = await supabase
    .from('invoices')
    .select('status, amount, due_date, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (!invoices || invoices.length === 0) {
    return {
      success: true,
      message: "You don't have any invoices on file. Your account is in good standing!",
    };
  }

  const byStatus = {};
  let totalOutstanding = 0;
  let totalOverdue = 0;

  invoices.forEach(inv => {
    byStatus[inv.status] = (byStatus[inv.status] || 0) + 1;
    if (inv.status === 'pending') totalOutstanding += parseFloat(inv.amount || 0);
    if (inv.status === 'overdue') totalOverdue += parseFloat(inv.amount || 0);
  });

  let message = `Billing summary:
- Total invoices: ${invoices.length}
- Outstanding balance: $${totalOutstanding.toFixed(2)}
- Overdue amount: $${totalOverdue.toFixed(2)}`;

  if (byStatus.overdue > 0) {
    message += `\n- ⚠️ You have ${byStatus.overdue} overdue invoice(s) totaling $${totalOverdue.toFixed(2)}. Would you like me to transfer you to Jon to discuss payment options?`;
  } else {
    message += '\n- Your account is in good standing!';
  }

  if (includeHistory) {
    const recentInvoices = invoices.slice(0, 6).map(inv =>
      `- $${parseFloat(inv.amount).toFixed(2)} — ${inv.status} (due ${inv.due_date})`
    ).join('\n');
    message += `\n\nRecent invoices:\n${recentInvoices}`;
  }

  return { success: true, message };
}

/**
 * Transfer the call to Jon
 * Returns a response that tells the VAPI agent to initiate a call transfer
 */
async function transferToJon(reason, callerInfo = {}) {
  const jonPhone = process.env.VAPI_JON_PHONE_NUMBER;

  console.log(`[Support] Transfer to Jon requested`);
  console.log(`[Support] Reason: ${reason}`);
  console.log(`[Support] Caller: ${callerInfo.caller_name || 'Unknown'} (${callerInfo.caller_phone || 'Unknown'})`);

  if (!jonPhone) {
    console.error('[Support] VAPI_JON_PHONE_NUMBER not set in .env');
    return {
      success: false,
      message: "I'm sorry, I'm unable to transfer the call right now. Can I take your number and have Jon call you back? You can also reach him at jonathan@runbyai.co.",
    };
  }

  // Log the transfer attempt to the database for tracking
  try {
    await supabase.from('alerts').insert({
      client_id: callerInfo.client_id || null,
      type: 'call_transfer',
      severity: 'info',
      message: `Call transfer to Jon — Reason: ${reason}. Caller: ${callerInfo.caller_name || 'Unknown'} (${callerInfo.caller_phone || 'Unknown'})`,
    });
  } catch (err) {
    console.error('[Support] Failed to log transfer alert:', err.message);
  }

  return {
    success: true,
    message: `Transferring you to Jon now. One moment please...`,
    forwardingPhoneNumber: jonPhone,
    destination: {
      type: 'number',
      number: jonPhone,
      message: `Incoming transfer from RunBy AI. Reason: ${reason}. Caller: ${callerInfo.caller_name || 'Unknown'}.`,
    },
  };
}

module.exports = { lookupClientAccount, checkBillingStatus, transferToJon };
