// core/client-briefing.js
// Per-client daily briefing emails
// Sends each active business owner an AI-generated morning briefing about their business
// Runs daily at 6:00 AM alongside the CAO admin briefing

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 2000;

// ─────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────

/**
 * Run briefings for all active clients
 */
async function runClientBriefings() {
  console.log(`\n========================================`);
  console.log(`[Client Briefings] Starting daily client briefings`);
  console.log(`[Client Briefings] ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  console.log(`========================================\n`);

  try {
    const clients = await getActiveClientsForBriefing();

    if (clients.length === 0) {
      console.log('[Client Briefings] No active clients with owner emails — skipping');
      return { status: 'skipped', reason: 'no_clients', sent: 0, failed: 0 };
    }

    console.log(`[Client Briefings] Found ${clients.length} active client(s) to brief`);

    let sent = 0;
    let failed = 0;
    const failures = [];

    // Process in batches to respect API rate limits
    for (let i = 0; i < clients.length; i += BATCH_SIZE) {
      const batch = clients.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Client Briefings] Processing batch ${batchNum} (${batch.length} clients)...`);

      const results = await Promise.allSettled(
        batch.map(client => processClientBriefing(client))
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          sent++;
        } else {
          failed++;
          failures.push({
            client_id: batch[j].client_id,
            business_name: batch[j].business_name,
            error: results[j].reason?.message || 'Unknown error',
          });
          console.error(`[Client Briefings] Failed for ${batch[j].business_name}:`, results[j].reason?.message);
        }
      }

      // Pause between batches to avoid rate limits
      if (i + BATCH_SIZE < clients.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    console.log(`\n[Client Briefings] Complete: ${sent} sent, ${failed} failed out of ${clients.length}`);

    // If any failures, send summary alert to admin
    if (failures.length > 0) {
      await sendFailureAlert(failures);
    }

    return { status: 'complete', sent, failed, total: clients.length };

  } catch (error) {
    console.error('[Client Briefings] Fatal error:', error.message);
    try {
      await sendFailureAlert([{ client_id: null, business_name: 'SYSTEM', error: error.message }]);
    } catch (e) {
      console.error('[Client Briefings] Failed to send error alert:', e.message);
    }
    return { status: 'error', reason: error.message };
  }
}

/**
 * Process a single client's briefing end-to-end
 */
async function processClientBriefing(client) {
  console.log(`[Client Briefings] Processing: ${client.business_name} (${client.owner_email})`);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Gather all metrics in parallel
  const [callMetrics, upcomingBookings, alerts, invoiceMetrics] = await Promise.all([
    gatherClientCallMetrics(client.client_id, since),
    gatherClientUpcomingBookings(client.client_id),
    gatherClientAlerts(client.client_id),
    gatherClientInvoiceMetrics(client.client_id),
  ]);

  // Generate AI briefing
  const briefing = await generateClientBriefingWithClaude(client, {
    callMetrics,
    upcomingBookings,
    alerts,
    invoiceMetrics,
  });

  // Send the email
  await sendClientBriefingEmail(briefing, client, {
    callMetrics,
    upcomingBookings,
    alerts,
    invoiceMetrics,
  });

  console.log(`[Client Briefings] Sent briefing to ${client.owner_email}`);
  return { client_id: client.client_id, status: 'sent' };
}

// ─────────────────────────────────────────
// DATA GATHERING
// ─────────────────────────────────────────

/**
 * Get all active clients who have an owner email configured
 */
async function getActiveClientsForBriefing() {
  const { data, error } = await supabase
    .from('clients')
    .select(`
      id,
      name,
      business_name,
      vertical_id,
      client_config (
        owner_email,
        timezone,
        ai_name,
        services,
        service_area
      )
    `)
    .in('status', ['active', 'pilot']);

  if (error) {
    throw new Error(`Failed to fetch active clients: ${error.message}`);
  }

  // Flatten and filter to clients with owner emails
  return (data || [])
    .map(c => {
      const config = Array.isArray(c.client_config) ? c.client_config[0] : c.client_config;
      return {
        client_id: c.id,
        owner_name: c.name,
        business_name: c.business_name,
        vertical_id: c.vertical_id,
        owner_email: config?.owner_email,
        timezone: config?.timezone || 'America/New_York',
        ai_name: config?.ai_name || 'Alex',
        services: config?.services || [],
        service_area: config?.service_area || '',
      };
    })
    .filter(c => c.owner_email && c.owner_email.trim() !== '');
}

/**
 * Gather call metrics for a specific client (last 24h)
 */
async function gatherClientCallMetrics(clientId, since) {
  // Total calls
  const { count: totalCalls } = await supabase
    .from('interactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', since);

  // Calls by classification
  const { data: callsByType } = await supabase
    .from('interactions')
    .select('classification')
    .eq('client_id', clientId)
    .gte('created_at', since);

  const classificationCounts = {};
  (callsByType || []).forEach(c => {
    const cls = c.classification || 'unknown';
    classificationCounts[cls] = (classificationCounts[cls] || 0) + 1;
  });

  // Bookings created
  const { count: bookingsCreated } = await supabase
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', since);

  // Missed calls
  const { count: missedCalls } = await supabase
    .from('missed_calls')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', since);

  // Average call duration
  const { data: durations } = await supabase
    .from('interactions')
    .select('duration_seconds')
    .eq('client_id', clientId)
    .gte('created_at', since)
    .not('duration_seconds', 'is', null);

  const avgDuration = durations && durations.length > 0
    ? Math.round(durations.reduce((sum, d) => sum + (d.duration_seconds || 0), 0) / durations.length)
    : 0;

  // Sentiment breakdown
  const { data: sentiments } = await supabase
    .from('interactions')
    .select('sentiment')
    .eq('client_id', clientId)
    .gte('created_at', since);

  const sentimentCounts = {};
  (sentiments || []).forEach(s => {
    const sent = s.sentiment || 'unknown';
    sentimentCounts[sent] = (sentimentCounts[sent] || 0) + 1;
  });

  return {
    totalCalls: totalCalls || 0,
    classificationCounts,
    bookingsCreated: bookingsCreated || 0,
    missedCalls: missedCalls || 0,
    avgDurationSeconds: avgDuration,
    sentimentCounts,
    bookingConversion: totalCalls > 0
      ? ((bookingsCreated / totalCalls) * 100).toFixed(1) + '%'
      : 'N/A',
  };
}

/**
 * Get upcoming bookings for the next 7 days
 */
async function gatherClientUpcomingBookings(clientId) {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: bookings } = await supabase
    .from('bookings')
    .select('customer_name, service_type, scheduled_date, scheduled_time, status')
    .eq('client_id', clientId)
    .gte('scheduled_date', now.toISOString().split('T')[0])
    .lte('scheduled_date', sevenDaysFromNow.toISOString().split('T')[0])
    .neq('status', 'cancelled')
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true });

  return bookings || [];
}

/**
 * Get unread alerts for this client
 */
async function gatherClientAlerts(clientId) {
  const { data: alerts } = await supabase
    .from('alerts')
    .select('type, severity, message, created_at')
    .eq('client_id', clientId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(10);

  return alerts || [];
}

/**
 * Get invoice metrics for this client's customers
 */
async function gatherClientInvoiceMetrics(clientId) {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('status, amount')
    .eq('client_id', clientId);

  if (!invoices || invoices.length === 0) {
    return { totalInvoices: 0, byStatus: {}, totalOutstanding: 0, totalOverdue: 0 };
  }

  const byStatus = {};
  let totalOutstanding = 0;
  let totalOverdue = 0;

  invoices.forEach(inv => {
    byStatus[inv.status] = (byStatus[inv.status] || 0) + 1;
    if (inv.status === 'pending') totalOutstanding += parseFloat(inv.amount || 0);
    if (inv.status === 'overdue') totalOverdue += parseFloat(inv.amount || 0);
  });

  return {
    totalInvoices: invoices.length,
    byStatus,
    totalOutstanding: totalOutstanding.toFixed(2),
    totalOverdue: totalOverdue.toFixed(2),
  };
}

// ─────────────────────────────────────────
// AI ANALYSIS
// ─────────────────────────────────────────

/**
 * Generate a client-facing briefing using Claude
 */
async function generateClientBriefingWithClaude(client, metrics) {
  const systemPrompt = `You are a friendly, professional business intelligence assistant for ${client.business_name}. Their AI staff is named ${client.ai_name}.

Write a concise, actionable morning briefing for the business owner (${client.owner_name}). Focus on what THEY care about — their customers, their bookings, their revenue.

Your briefing should cover:
1. YESTERDAY'S PERFORMANCE — Calls received, how they were handled, bookings made
2. KEY METRICS — Conversion rate, missed opportunities, customer sentiment
3. TODAY'S SCHEDULE — Upcoming appointments
4. ACTION ITEMS — Anything needing the owner's attention (missed calls to return, alerts, overdue invoices)
5. INSIGHTS — Quick patterns or tips based on the data

Be warm and encouraging. Celebrate wins. Be direct about problems. Keep it tight — this is a busy business owner checking their phone in the morning.`;

  const upcomingStr = metrics.upcomingBookings.length > 0
    ? metrics.upcomingBookings.map(b =>
        `- ${b.scheduled_date} at ${b.scheduled_time}: ${b.service_type} for ${b.customer_name} (${b.status})`
      ).join('\n')
    : 'No upcoming bookings in the next 7 days';

  const alertsStr = metrics.alerts.length > 0
    ? metrics.alerts.map(a => `- [${a.severity}] ${a.type}: ${a.message}`).join('\n')
    : 'No unread alerts';

  const userMessage = `Here is today's data for ${client.business_name}. Generate the morning briefing.

BUSINESS: ${client.business_name}
VERTICAL: ${client.vertical_id}
AI RECEPTIONIST: ${client.ai_name}
SERVICE AREA: ${client.service_area}

CALL METRICS (last 24h):
${JSON.stringify(metrics.callMetrics, null, 2)}

UPCOMING BOOKINGS (next 7 days):
${upcomingStr}

ALERTS:
${alertsStr}

INVOICE METRICS:
${JSON.stringify(metrics.invoiceMetrics, null, 2)}

Respond in JSON format:
{
  "greeting": "Good morning, ${client.owner_name}!",
  "executive_summary": "1-2 sentence overview of yesterday",
  "sections": [
    { "title": "Section Title", "emoji": "📊", "content": "Markdown content for this section" }
  ],
  "action_items": ["Item 1", "Item 2"],
  "mood": "one of: excellent, good, quiet, needs_attention"
}`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return {
      greeting: `Good morning, ${client.owner_name}!`,
      executive_summary: 'Your daily briefing could not be generated. Check back tomorrow!',
      sections: [],
      action_items: [],
      mood: 'good',
    };
  } catch (e) {
    console.error(`[Client Briefings] Failed to parse briefing for ${client.business_name}:`, e.message);
    return {
      greeting: `Good morning, ${client.owner_name}!`,
      executive_summary: 'Your daily briefing encountered a formatting issue. Here are your raw metrics.',
      sections: [],
      action_items: [],
      mood: 'good',
    };
  }
}

// ─────────────────────────────────────────
// EMAIL DELIVERY
// ─────────────────────────────────────────

/**
 * Build and send the client briefing email
 */
async function sendClientBriefingEmail(briefing, client, rawData) {
  const moodConfig = {
    excellent: { emoji: '🟢', color: '#059669', label: 'Excellent' },
    good: { emoji: '🔵', color: '#1a56db', label: 'Good' },
    quiet: { emoji: '⚪', color: '#6b7280', label: 'Quiet Day' },
    needs_attention: { emoji: '🟡', color: '#D97706', label: 'Needs Attention' },
  };
  const mood = moodConfig[briefing.mood] || moodConfig.good;

  const cm = rawData.callMetrics;

  // Build sections HTML
  const sectionsHtml = (briefing.sections || []).map(section => `
    <div style="margin-bottom: 24px;">
      <h3 style="color: #1f2937; margin: 0 0 8px 0; font-size: 16px;">${section.emoji || '📋'} ${section.title}</h3>
      <div style="color: #4b5563; font-size: 14px; line-height: 1.6; white-space: pre-line;">${section.content}</div>
    </div>
  `).join('');

  // Action items
  const actionItemsHtml = (briefing.action_items || []).length > 0
    ? `<div style="background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #92400E;">⚡ Action Items</h3>
        <ul style="margin: 0; padding-left: 20px; color: #92400E;">
          ${briefing.action_items.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('')}
        </ul>
      </div>`
    : '';

  // Quick stats bar
  const statsBar = `
    <div style="display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap;">
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 80px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #1a56db;">${cm.totalCalls}</div>
        <div style="font-size: 12px; color: #6b7280;">Calls</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 80px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #059669;">${cm.bookingsCreated}</div>
        <div style="font-size: 12px; color: #6b7280;">Bookings</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 80px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #DC2626;">${cm.missedCalls}</div>
        <div style="font-size: 12px; color: #6b7280;">Missed</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 80px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #7C3AED;">${cm.bookingConversion}</div>
        <div style="font-size: 12px; color: #6b7280;">Conversion</div>
      </div>
    </div>
  `;

  // Upcoming bookings table
  const upcomingBookings = rawData.upcomingBookings || [];
  const upcomingHtml = upcomingBookings.length > 0
    ? `<div style="margin: 20px 0;">
        <h3 style="color: #1f2937; margin: 0 0 12px 0; font-size: 16px;">📅 Upcoming Appointments</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background: #f9fafb;">
              <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Date</th>
              <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Time</th>
              <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Service</th>
              <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">Customer</th>
            </tr>
          </thead>
          <tbody>
            ${upcomingBookings.slice(0, 10).map(b => `
              <tr>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${b.scheduled_date}</td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${b.scheduled_time}</td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${b.service_type}</td>
                <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${b.customer_name}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${upcomingBookings.length > 10 ? `<p style="color: #6b7280; font-size: 12px; margin-top: 8px;">+ ${upcomingBookings.length - 10} more appointments</p>` : ''}
      </div>`
    : '';

  // Alerts section
  const alertsData = rawData.alerts || [];
  const alertsHtml = alertsData.length > 0
    ? `<div style="background: #FEE2E2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #991B1B;">🚨 Alerts Requiring Attention</h3>
        <ul style="margin: 0; padding-left: 20px; color: #991B1B;">
          ${alertsData.map(a => `<li style="margin-bottom: 4px;"><strong>${a.type}</strong>: ${a.message}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: client.timezone || 'America/New_York',
  });

  const currentTime = new Date().toLocaleTimeString('en-US', {
    timeZone: client.timezone || 'America/New_York',
  });

  const subject = `${mood.emoji} Your Daily Briefing — ${today}`;

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; background: #f3f4f6;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #1E3A5F 0%, #1a56db 100%); color: white; padding: 30px; text-align: center;">
        <h1 style="margin: 0 0 4px 0; font-size: 22px;">${client.business_name}</h1>
        <p style="margin: 0; opacity: 0.8; font-size: 14px;">Daily Briefing — ${today}</p>
        <div style="margin-top: 12px;">
          <span style="background: ${mood.color}; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: bold;">
            ${mood.emoji} ${mood.label}
          </span>
        </div>
      </div>

      <div style="padding: 24px;">
        <!-- Greeting & Executive Summary -->
        <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid ${mood.color};">
          <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1f2937;">${briefing.greeting}</p>
          <p style="margin: 0; font-size: 15px; color: #4b5563; line-height: 1.6;">${briefing.executive_summary}</p>
        </div>

        <!-- Quick Stats -->
        ${statsBar}

        <!-- Alerts (if any) -->
        ${alertsHtml}

        <!-- AI-Generated Sections -->
        <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          ${sectionsHtml}
        </div>

        <!-- Upcoming Bookings -->
        ${upcomingHtml}

        <!-- Action Items -->
        ${actionItemsHtml}

        <!-- Footer -->
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0;">Powered by <strong>RunBy AI</strong> for ${client.business_name}</p>
          <p style="margin: 4px 0 0 0;">Your AI staff ${client.ai_name} is handling calls 24/7</p>
          <p style="margin: 4px 0 0 0;">Generated at ${currentTime} ${getTimezoneAbbr(client.timezone)}</p>
        </div>
      </div>
    </div>
  `;

  const emailContent = {
    personalizations: [{
      to: [{ email: client.owner_email }],
      subject,
    }],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: `${client.ai_name} @ ${client.business_name}`,
    },
    content: [{
      type: 'text/html',
      value: htmlContent,
    }],
  };

  const response = await fetch(SENDGRID_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailContent),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`SendGrid error ${response.status}: ${errorBody}`);
  }

  // Log the email
  await logEmail({
    client_id: client.client_id,
    recipient_email: client.owner_email,
    email_type: 'client-briefing',
    subject,
    delivery_status: 'sent',
  });

  return true;
}

/**
 * Log email to the email_logs table
 */
async function logEmail({ client_id, recipient_email, email_type, subject, delivery_status }) {
  try {
    await supabase.from('email_logs').insert({
      client_id,
      recipient_email,
      email_type,
      subject,
      delivery_status: delivery_status || 'sent',
    });
  } catch (err) {
    console.error('[Client Briefings] Failed to log email:', err.message);
  }
}

/**
 * Send an alert to admin if any client briefings failed
 */
async function sendFailureAlert(failures) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'jonathan@runbyai.co';

  const failureRows = failures.map(f =>
    `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6;">${f.business_name}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #f3f4f6; color: #DC2626;">${f.error}</td>
    </tr>`
  ).join('');

  const emailContent = {
    personalizations: [{
      to: [{ email: adminEmail }],
      subject: `⚠️ RunBy — Client Briefing Failures (${failures.length})`,
    }],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: 'RunBy Client Briefings',
    },
    content: [{
      type: 'text/html',
      value: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <h2 style="color: #D97706;">Client Briefing Failures</h2>
          <p>${failures.length} client briefing(s) failed to send:</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">Business</th>
                <th style="text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">Error</th>
              </tr>
            </thead>
            <tbody>${failureRows}</tbody>
          </table>
          <p style="color: #6b7280; font-size: 12px; margin-top: 16px;">
            Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}
          </p>
        </div>
      `,
    }],
  };

  await fetch(SENDGRID_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailContent),
  });
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTimezoneAbbr(tz) {
  const abbrs = {
    'America/New_York': 'ET',
    'America/Chicago': 'CT',
    'America/Denver': 'MT',
    'America/Los_Angeles': 'PT',
    'America/Phoenix': 'MST',
    'America/Anchorage': 'AKT',
    'Pacific/Honolulu': 'HT',
  };
  return abbrs[tz] || tz || 'ET';
}

// ─────────────────────────────────────────
// CLI SUPPORT
// ─────────────────────────────────────────

if (require.main === module) {
  runClientBriefings().then(result => {
    console.log('\n[Client Briefings] Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runClientBriefings };
