// core/chief-agent-officer.js
// Ross — Chief Agent Officer
// Oversees all RunBy agents, monitors performance, and sends a daily executive briefing
// Runs daily at 6:00 AM before all optimizer agents

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function getAdminEmail() {
  return process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'jonathan@runbyai.co';
}

function getBriefingFromEmail(recipientEmail) {
  const explicitFrom = process.env.BRIEFING_FROM_EMAIL || process.env.ADMIN_NOTIFICATION_FROM_EMAIL;
  if (explicitFrom) return explicitFrom;

  const defaultFrom = process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com';
  if (defaultFrom.toLowerCase() !== String(recipientEmail || '').toLowerCase()) {
    return defaultFrom;
  }

  // Avoid self-sending from the same inbox address when no dedicated sender is configured.
  return 'support@runbyai.co';
}

function appendDeliveryLog(entry) {
  const logsDir = path.join(__dirname, '..', 'reports', 'cao', 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const logPath = path.join(logsDir, `delivery_${date}.log`);
  fs.appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
}

/**
 * Main Ross function — gathers intelligence from all agents and sends a morning briefing
 */
async function runDailyBriefing() {
  console.log(`\n========================================`);
  console.log(`[Ross] Chief Agent Officer — Daily Briefing`);
  console.log(`[Ross] ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  console.log(`========================================\n`);

  try {
    // 1. Gather data from all sources
    const verticals = getActiveVerticals();
    const optimizerReports = gatherOptimizerReports(verticals);
    const callMetrics = await gatherCallMetrics();
    const emailMetrics = await gatherEmailMetrics();
    const invoiceMetrics = await gatherInvoiceMetrics();
    const agentHealth = checkAgentHealth(verticals);
    const newVerticals = checkForNewVerticals();

    // 2. Send everything to Claude for analysis and executive summary
    const briefing = await generateBriefingWithClaude({
      verticals,
      optimizerReports,
      callMetrics,
      emailMetrics,
      invoiceMetrics,
      agentHealth,
      newVerticals,
    });

    // 3. Build and send the email
    await sendBriefingEmail(briefing, {
      verticals,
      optimizerReports,
      callMetrics,
      emailMetrics,
      invoiceMetrics,
      agentHealth,
      newVerticals,
    });

    // 4. Save briefing to filesystem
    saveBriefing(briefing);

    // 5. Snapshot all vertical files into their backups directories
    backupVerticalFiles(verticals);

    console.log(`[Ross] Daily briefing complete and sent`);
    return { status: 'sent', summary: briefing.executive_summary };

  } catch (error) {
    console.error(`[Ross] Error running daily briefing:`, error.message);

    // Even if something fails, try to send an error alert
    try {
      await sendErrorAlert(error.message);
    } catch (e) {
      console.error(`[Ross] Failed to send error alert:`, e.message);
    }

    return { status: 'error', reason: error.message };
  }
}

// ─────────────────────────────────────────
// DATA GATHERING
// ─────────────────────────────────────────

/**
 * Get all active verticals
 */
function getActiveVerticals() {
  const verticalsDir = path.join(__dirname, '..', 'verticals');
  if (!fs.existsSync(verticalsDir)) return [];

  return fs.readdirSync(verticalsDir).filter(d => {
    const dirPath = path.join(verticalsDir, d);
    return fs.statSync(dirPath).isDirectory() &&
           fs.existsSync(path.join(dirPath, 'prompt.md'));
  });
}

/**
 * Gather the most recent optimizer report for each vertical
 */
function gatherOptimizerReports(verticals) {
  const reports = {};

  for (const vertical of verticals) {
    const reportsDir = path.join(__dirname, '..', 'verticals', vertical, 'reports');
    if (!fs.existsSync(reportsDir)) {
      reports[vertical] = { status: 'no_reports', data: null };
      continue;
    }

    const files = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith('report_') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      reports[vertical] = { status: 'no_reports', data: null };
      continue;
    }

    try {
      const latest = JSON.parse(fs.readFileSync(path.join(reportsDir, files[0]), 'utf8'));
      reports[vertical] = { status: 'ok', data: latest, file: files[0] };
    } catch (e) {
      reports[vertical] = { status: 'error', error: e.message };
    }
  }

  return reports;
}

/**
 * Gather call metrics from the last 24 hours
 */
async function gatherCallMetrics() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Total calls
  const { count: totalCalls } = await supabase
    .from('interactions')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since);

  // Calls by classification
  const { data: callsByType } = await supabase
    .from('interactions')
    .select('classification')
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
    .gte('created_at', since);

  // Missed calls
  const { count: missedCalls } = await supabase
    .from('missed_calls')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since);

  // Average call duration
  const { data: durations } = await supabase
    .from('interactions')
    .select('duration_seconds')
    .gte('created_at', since)
    .not('duration_seconds', 'is', null);

  const avgDuration = durations && durations.length > 0
    ? Math.round(durations.reduce((sum, d) => sum + (d.duration_seconds || 0), 0) / durations.length)
    : 0;

  // Sentiment breakdown
  const { data: sentiments } = await supabase
    .from('interactions')
    .select('sentiment')
    .gte('created_at', since);

  const sentimentCounts = {};
  (sentiments || []).forEach(s => {
    const sent = s.sentiment || 'unknown';
    sentimentCounts[sent] = (sentimentCounts[sent] || 0) + 1;
  });

  // Calls per client (top 5)
  const { data: callsByClient } = await supabase
    .from('interactions')
    .select('client_id')
    .gte('created_at', since);

  const clientCounts = {};
  (callsByClient || []).forEach(c => {
    clientCounts[c.client_id] = (clientCounts[c.client_id] || 0) + 1;
  });

  const activeClients = Object.keys(clientCounts).length;

  return {
    totalCalls: totalCalls || 0,
    classificationCounts,
    bookingsCreated: bookingsCreated || 0,
    missedCalls: missedCalls || 0,
    avgDurationSeconds: avgDuration,
    sentimentCounts,
    activeClients,
    bookingConversion: totalCalls > 0 ? ((bookingsCreated / totalCalls) * 100).toFixed(1) + '%' : 'N/A',
  };
}

/**
 * Gather email metrics from the last 24 hours
 */
async function gatherEmailMetrics() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: emails } = await supabase
    .from('email_logs')
    .select('email_type, delivery_status')
    .gte('sent_at', since);

  const byType = {};
  const byStatus = { sent: 0, failed: 0 };

  (emails || []).forEach(e => {
    byType[e.email_type] = (byType[e.email_type] || 0) + 1;
    byStatus[e.delivery_status] = (byStatus[e.delivery_status] || 0) + 1;
  });

  return {
    totalSent: (emails || []).length,
    byType,
    byStatus,
    deliveryRate: (emails || []).length > 0
      ? ((byStatus.sent / (emails || []).length) * 100).toFixed(1) + '%'
      : 'N/A',
  };
}

/**
 * Gather invoice metrics
 */
async function gatherInvoiceMetrics() {
  const { data: invoices } = await supabase
    .from('invoices')
    .select('status, amount');

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

/**
 * Check health of all agent files
 */
// Internal RunBy verticals that don't use per-client template variables
const INTERNAL_VERTICALS = ['onboarding', 'sales', 'marketing'];

function checkAgentHealth(verticals) {
  const health = {};

  for (const vertical of verticals) {
    const promptPath = path.join(__dirname, '..', 'verticals', vertical, 'prompt.md');
    const rulesPath = path.join(__dirname, '..', 'verticals', vertical, 'rules.json');
    const isInternal = INTERNAL_VERTICALS.includes(vertical);

    const checks = {
      promptExists: fs.existsSync(promptPath),
      rulesExists: fs.existsSync(rulesPath),
      rulesValidJson: false,
      templateVarsIntact: false,
      hasBackups: fs.existsSync(path.join(__dirname, '..', 'verticals', vertical, 'backups')),
      isInternal,
    };

    // Validate rules.json
    if (checks.rulesExists) {
      try {
        JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
        checks.rulesValidJson = true;
      } catch (e) {
        checks.rulesValidJson = false;
      }
    }

    // Check template variables — skip for internal verticals (they don't use per-client vars)
    if (checks.promptExists) {
      if (isInternal) {
        checks.templateVarsIntact = true; // N/A for internal verticals
      } else {
        const prompt = fs.readFileSync(promptPath, 'utf8');
        const requiredVars = ['{{ai_name}}', '{{business_name}}', '{{services}}', '{{business_hours}}', '{{service_area}}', '{{current_date}}', '{{current_time}}'];
        checks.templateVarsIntact = requiredVars.every(v => prompt.includes(v));
      }
    }

    const allGood = checks.promptExists && checks.rulesExists && checks.rulesValidJson && checks.templateVarsIntact;
    health[vertical] = { status: allGood ? 'healthy' : 'needs_attention', checks };
  }

  return health;
}

/**
 * Check for any verticals created in the last 7 days
 */
function checkForNewVerticals() {
  const verticals = getActiveVerticals();
  const newOnes = [];
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const vertical of verticals) {
    const reportsDir = path.join(__dirname, '..', 'verticals', vertical, 'reports');
    if (!fs.existsSync(reportsDir)) continue;

    const creationReports = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith('creation_report_'));

    for (const report of creationReports) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(reportsDir, report), 'utf8'));
        const reportDate = new Date(data.date);
        if (reportDate.getTime() > sevenDaysAgo) {
          newOnes.push({ vertical_id: vertical, date: data.date, display_name: data.display_name, category: data.category });
        }
      } catch (e) { /* skip */ }
    }
  }

  return newOnes;
}

// ─────────────────────────────────────────
// AI ANALYSIS
// ─────────────────────────────────────────

/**
 * Ask Claude to generate an executive briefing from all the gathered data
 */
async function generateBriefingWithClaude(data) {
  const systemPrompt = `You are Ross, the Chief Agent Officer for RunBy, an AI staff platform. You oversee a fleet of AI optimization agents that improve call-handling prompts daily.

Write a concise, executive-quality morning briefing for the CEO (Jon). Be direct, highlight what matters, flag problems, and celebrate wins. Use a professional but warm tone.

Your briefing should cover:
1. EXECUTIVE SUMMARY — 2-3 sentences on the overall state of the platform
2. CALL PERFORMANCE — Key metrics, trends, conversion rates
3. AGENT PERFORMANCE — Which optimizer agents made changes, what they improved
4. HEALTH STATUS — Any agents with broken files, missing templates, or errors
5. EMAIL & INVOICES — Delivery stats, overdue invoices needing attention
6. NEW VERTICALS — Any new verticals created this week by the creator agent
7. ACTION ITEMS — 1-3 things that need human attention (if any)
8. OUTLOOK — What to watch today

Keep it tight. Jon is busy.`;

  const userMessage = `Here is today's data. Generate the morning briefing.

ACTIVE VERTICALS: ${data.verticals.join(', ')} (${data.verticals.length} total)

CALL METRICS (last 24h):
${JSON.stringify(data.callMetrics, null, 2)}

OPTIMIZER REPORTS (latest per vertical):
${JSON.stringify(Object.entries(data.optimizerReports).map(([v, r]) => ({
  vertical: v,
  status: r.status,
  summary: r.data?.analysis || 'No data',
  changes: r.data?.changes_applied?.length || 0,
  calls_analyzed: r.data?.calls_analyzed || 0,
})), null, 2)}

AGENT HEALTH:
${JSON.stringify(data.agentHealth, null, 2)}

EMAIL METRICS (last 24h):
${JSON.stringify(data.emailMetrics, null, 2)}

INVOICE METRICS:
${JSON.stringify(data.invoiceMetrics, null, 2)}

NEW VERTICALS (last 7 days):
${data.newVerticals.length > 0 ? JSON.stringify(data.newVerticals, null, 2) : 'None'}

Respond in JSON format:
{
  "executive_summary": "2-3 sentence overview",
  "sections": [
    { "title": "Section Title", "emoji": "📊", "content": "Markdown content for this section" }
  ],
  "action_items": ["Item 1", "Item 2"],
  "health_score": 0-100,
  "mood": "one of: excellent, good, needs_attention, critical"
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
      max_tokens: 4096,
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
    return { executive_summary: 'Briefing generation failed', sections: [], action_items: [], health_score: 0, mood: 'critical' };
  } catch (e) {
    console.error(`[Ross] Failed to parse briefing:`, e.message);
    return { executive_summary: 'Briefing generation failed — parse error', sections: [], action_items: [], health_score: 0, mood: 'critical' };
  }
}

// ─────────────────────────────────────────
// EMAIL DELIVERY
// ─────────────────────────────────────────

/**
 * Send the morning briefing email
 */
async function sendBriefingEmail(briefing, rawData) {
  const adminEmail = getAdminEmail();
  const fromEmail = getBriefingFromEmail(adminEmail);

  // Mood emoji and color
  const moodConfig = {
    excellent: { emoji: '🟢', color: '#059669', label: 'Excellent' },
    good: { emoji: '🔵', color: '#1a56db', label: 'Good' },
    needs_attention: { emoji: '🟡', color: '#D97706', label: 'Needs Attention' },
    critical: { emoji: '🔴', color: '#DC2626', label: 'Critical' },
  };
  const mood = moodConfig[briefing.mood] || moodConfig.good;

  // Build sections HTML
  const sectionsHtml = (briefing.sections || []).map(section => `
    <div style="margin-bottom: 24px;">
      <h3 style="color: #1f2937; margin: 0 0 8px 0; font-size: 16px;">${section.emoji || '📋'} ${section.title}</h3>
      <div style="color: #4b5563; font-size: 14px; line-height: 1.6; white-space: pre-line;">${section.content}</div>
    </div>
  `).join('');

  // Action items HTML
  const actionItemsHtml = (briefing.action_items || []).length > 0
    ? `<div style="background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px 0; color: #92400E;">⚡ Action Items</h3>
        <ul style="margin: 0; padding-left: 20px; color: #92400E;">
          ${briefing.action_items.map(item => `<li style="margin-bottom: 4px;">${item}</li>`).join('')}
        </ul>
      </div>`
    : '';

  // Quick stats bar
  const cm = rawData.callMetrics;
  const statsBar = `
    <div style="display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap;">
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 100px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #1a56db;">${cm.totalCalls}</div>
        <div style="font-size: 12px; color: #6b7280;">Calls</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 100px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #059669;">${cm.bookingsCreated}</div>
        <div style="font-size: 12px; color: #6b7280;">Bookings</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 100px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #DC2626;">${cm.missedCalls}</div>
        <div style="font-size: 12px; color: #6b7280;">Missed</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 100px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #7C3AED;">${cm.bookingConversion}</div>
        <div style="font-size: 12px; color: #6b7280;">Conversion</div>
      </div>
      <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 100px; text-align: center;">
        <div style="font-size: 24px; font-weight: bold; color: #0891B2;">${rawData.verticals.length}</div>
        <div style="font-size: 12px; color: #6b7280;">Verticals</div>
      </div>
    </div>
  `;

  // Agent health grid
  const healthGrid = Object.entries(rawData.agentHealth).map(([vertical, info]) => {
    const statusEmoji = info.status === 'healthy' ? '✅' : '⚠️';
    return `<span style="display: inline-block; background: ${info.status === 'healthy' ? '#D1FAE5' : '#FEF3C7'}; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin: 2px;">${statusEmoji} ${vertical}</span>`;
  }).join(' ');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/New_York',
  });

  const emailContent = {
    personalizations: [{
      to: [{ email: adminEmail }],
      subject: `${mood.emoji} RunBy Daily Briefing — ${today} (Score: ${briefing.health_score}/100)`,
    }],
    from: {
      email: fromEmail,
      name: 'Ross @ RunBy',
    },
    reply_to: {
      email: adminEmail,
      name: 'Jon @ RunBy',
    },
    content: [{
      type: 'text/html',
      value: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 680px; margin: 0 auto; background: #f3f4f6;">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1E3A5F 0%, #1a56db 100%); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0 0 4px 0; font-size: 22px;">RunBy — Ross</h1>
            <p style="margin: 0; opacity: 0.8; font-size: 14px;">Daily Briefing — ${today}</p>
            <div style="margin-top: 12px;">
              <span style="background: ${mood.color}; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: bold;">
                ${mood.emoji} ${mood.label} — Health Score: ${briefing.health_score}/100
              </span>
            </div>
          </div>

          <div style="padding: 24px;">
            <!-- Executive Summary -->
            <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid ${mood.color};">
              <p style="margin: 0; font-size: 15px; color: #1f2937; line-height: 1.6;">${briefing.executive_summary}</p>
            </div>

            <!-- Quick Stats -->
            ${statsBar}

            <!-- Agent Health -->
            <div style="margin-bottom: 20px;">
              <h3 style="color: #1f2937; margin: 0 0 8px 0; font-size: 14px;">🤖 Agent Health</h3>
              <div>${healthGrid}</div>
            </div>

            <!-- Sections -->
            <div style="background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              ${sectionsHtml}
            </div>

            <!-- Action Items -->
            ${actionItemsHtml}

            <!-- Footer -->
            <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0;">RunBy AI Platform — Ross (Chief Agent Officer)</p>
              <p style="margin: 4px 0 0 0;">Generated at ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET</p>
              <p style="margin: 4px 0 0 0; font-style: italic;">Next optimizer agents run at 6:00–6:40 AM ET</p>
            </div>
          </div>
        </div>
      `,
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
    appendDeliveryLog({
      type: 'ross-briefing',
      recipient: adminEmail,
      from: fromEmail,
      subject: emailContent.personalizations[0].subject,
      status: response.status,
      outcome: 'failed',
      error: errorBody,
    });
    throw new Error(`SendGrid Ross briefing error ${response.status}: ${errorBody}`);
  }

  appendDeliveryLog({
    type: 'ross-briefing',
    recipient: adminEmail,
    from: fromEmail,
    subject: emailContent.personalizations[0].subject,
    status: response.status,
    outcome: 'accepted',
    message_id: response.headers.get('x-message-id') || null,
  });

  console.log(`[Ross] Briefing email accepted by SendGrid for ${adminEmail} (from ${fromEmail})`);
  return true;
}

/**
 * Send an error alert if Ross itself fails
 */
async function sendErrorAlert(errorMessage) {
  const adminEmail = getAdminEmail();
  const fromEmail = getBriefingFromEmail(adminEmail);

  const emailContent = {
    personalizations: [{
      to: [{ email: adminEmail }],
      subject: `🔴 RunBy — Ross Error — Daily Briefing Failed`,
    }],
    from: {
      email: fromEmail,
      name: 'Ross @ RunBy',
    },
    reply_to: {
      email: adminEmail,
      name: 'Jon @ RunBy',
    },
    content: [{
      type: 'text/html',
      value: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <h2 style="color: #DC2626;">Ross — Daily Briefing Failed</h2>
          <p>Ross encountered an error while generating today's briefing:</p>
          <div style="background: #FEE2E2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <code style="color: #991B1B;">${errorMessage}</code>
          </div>
          <p>The optimizer agents will still run on their normal schedule. Please investigate when you have a chance.</p>
          <p style="color: #6b7280; font-size: 12px;">Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
        </div>
      `,
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

  appendDeliveryLog({
    type: 'ross-error-alert',
    recipient: adminEmail,
    from: fromEmail,
    subject: emailContent.personalizations[0].subject,
    status: response.status,
    outcome: response.ok ? 'accepted' : 'failed',
  });
}

/**
 * Save the briefing to the reports directory
 */
function saveBriefing(briefing) {
  const reportsDir = path.join(__dirname, '..', 'reports', 'cao');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().split('T')[0];
  fs.writeFileSync(
    path.join(reportsDir, `briefing_${timestamp}.json`),
    JSON.stringify(briefing, null, 2)
  );
  console.log(`[Ross] Briefing saved to reports/cao/briefing_${timestamp}.json`);
}

/**
 * Snapshot prompt.md and rules.json for every vertical into its backups directory.
 * Keeps the last 30 daily snapshots per vertical to avoid unbounded growth.
 */
function backupVerticalFiles(verticals) {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const KEEP_DAYS = 30;

  for (const vertical of verticals) {
    const verticalDir = path.join(__dirname, '..', 'verticals', vertical);
    const backupsDir = path.join(verticalDir, 'backups');

    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    // Copy prompt.md and rules.json if they exist
    const filesToBackup = ['prompt.md', 'rules.json'];
    for (const file of filesToBackup) {
      const src = path.join(verticalDir, file);
      if (!fs.existsSync(src)) continue;
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const dest = path.join(backupsDir, `${base}_${timestamp}${ext}`);
      fs.copyFileSync(src, dest);
    }

    // Prune old backups — keep only the most recent KEEP_DAYS snapshots per file type
    for (const file of filesToBackup) {
      const ext = path.extname(file);
      const base = path.basename(file, ext);
      const pattern = new RegExp(`^${base}_\\d{4}-\\d{2}-\\d{2}\\${ext}$`);
      const existing = fs.readdirSync(backupsDir)
        .filter(f => pattern.test(f))
        .sort(); // ascending — oldest first
      if (existing.length > KEEP_DAYS) {
        const toDelete = existing.slice(0, existing.length - KEEP_DAYS);
        for (const old of toDelete) {
          fs.unlinkSync(path.join(backupsDir, old));
        }
      }
    }

    console.log(`[Ross] Backed up ${vertical} → backups/${timestamp}`);
  }
}

// CLI support
if (require.main === module) {
  runDailyBriefing().then(result => {
    console.log('\n[Ross] Result:', JSON.stringify(result, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runDailyBriefing };
