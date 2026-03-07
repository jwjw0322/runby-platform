// core/email-campaign.js
// Cold outreach email campaign with A/B testing
// Usage:
//   node core/email-campaign.js --file leads.csv                    # Send initial emails
//   node core/email-campaign.js --follow-up --days 3                # Send Day 3 follow-ups
//   node core/email-campaign.js --follow-up --days 7                # Send Day 7 follow-ups
//   node core/email-campaign.js --follow-up --days 14               # Send Day 14 breakup
//   node core/email-campaign.js --follow-up --days 3 --force        # Force follow-up send now (testing)
//   node core/email-campaign.js --stats                             # Show campaign stats
//
// CSV format: first_name,email,business_name,vertical
// Verticals: hvac, plumbing, electrical, roofing, medspa, general-contractor

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CAMPAIGN_ID = '001-cold-outreach-free-trial';
const PRICING_URL = 'https://runbyai.co/pricing';
const PHONE = '(786) 733-2209';
const CAMPAIGN_LOG_DIR = path.join(__dirname, '..', 'reports', 'campaigns');
const CAMPAIGN_LOG_FILE = path.join(CAMPAIGN_LOG_DIR, `${CAMPAIGN_ID}.jsonl`);

function readCampaignLog() {
  if (!fs.existsSync(CAMPAIGN_LOG_FILE)) return [];
  const lines = fs.readFileSync(CAMPAIGN_LOG_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const rows = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch (_) {
      // Skip malformed historical lines
    }
  }
  return rows;
}

function appendCampaignLog(entry) {
  if (!fs.existsSync(CAMPAIGN_LOG_DIR)) {
    fs.mkdirSync(CAMPAIGN_LOG_DIR, { recursive: true });
  }
  fs.appendFileSync(CAMPAIGN_LOG_FILE, JSON.stringify(entry) + '\n');
}

// ── A/B Version Assignment ──
function assignVersion(email) {
  // Deterministic hash so the same email always gets the same version
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash) + email.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2 === 0 ? 'A' : 'B';
}

// ── Email Templates ──

const VERSION_A = {
  // Pain Point angle
  hvac: {
    subject: 'You missed 3 calls today. I know because everyone does.',
    body: (name) => `Hey ${name},

Quick question — what happens when a homeowner's AC goes out at 7 PM and they call your shop?

If the answer is voicemail, you just lost a $400-800 job to whoever picks up next.

The average HVAC company misses 62% of inbound calls. Not because they don't care — because they're on a roof or under a unit.

We built something that fixes this. We built something that fixes this. RunBy gives you AI-powered staff that handles calls, bookings, follow-ups, and invoicing — 24/7 — so you stop losing revenue and stop doing admin work that doesn't need you.

It sounds like a real person. It knows your services, your hours, your service area. And it costs a fraction of one real employee.

14-day free trial. Takes 10 minutes to set up. No credit card.

Start your free trial: ${PRICING_URL}

If this isn't for you, no worries. But if you're tired of checking voicemails at 9 PM and wondering how many jobs you lost today — this is worth 10 minutes.

Jon
RunBy | Your AI Employee
${PHONE}`,
  },
  plumbing: {
    subject: 'That emergency call you missed last night? Someone else got the job.',
    body: (name) => `Hey ${name},

Plumbing emergencies don't wait until business hours. But your phone does.

Every call that hits voicemail is a customer who calls the next plumber on Google — and 78% of people hire whoever picks up first.

We built RunBy to solve this. It's AI-powered staff that handles your calls 24/7, asks the right questions, books the job on your calendar, and follows up on invoices — all while you're doing actual work.

No app to learn. No staff to manage. A fraction of the cost of one employee.

14-day free trial — takes 10 minutes to set up.

Start here: ${PRICING_URL}

Jon
RunBy | Your AI Employee
${PHONE}`,
  },
  electrical: {
    subject: '62% of your calls go to voicemail. That\'s not a phone problem — it\'s a revenue problem.',
    body: (name) => `Hey ${name},

You're probably in someone's panel box right now, so I'll keep this short.

Most electrical contractors miss more than half their calls. That's not a guess — it's the industry average. And every one of those missed calls is a job that goes to someone else.

RunBy is AI-powered staff that handles your calls, bookings, follow-ups, and invoicing — 24/7. Customers get instant service. You get an alert. No admin piling up.

It knows your services, your area, your hours. Sounds like a real person. Costs a fraction of one employee — and does the work of three.

Free 14-day trial. No credit card. 10-minute setup.

Try it: ${PRICING_URL}

Jon
RunBy | Your AI Employee
${PHONE}`,
  },
  roofing: {
    subject: 'Storm season is coming. Can you answer 50 calls in one day?',
    body: (name) => `Hey ${name},

After every big storm, roofing companies get flooded with calls. And the ones who answer fastest book the most inspections.

But you can only pick up one call at a time. What about the other 49?

RunBy gives you AI-powered staff that handles every call simultaneously — 24/7. It talks to the homeowner, qualifies the job, books the inspection, and sends a confirmation. No hold music. No voicemail. No lost revenue.

When storm season hits, the roofers using RunBy will book 3x more inspections — because they have a team that scales instantly while everyone else is drowning in voicemails.

14-day free trial. No credit card. Live in 24 hours.

Get set up before storm season: ${PRICING_URL}

Jon
RunBy | Your AI Employee
${PHONE}`,
  },
  medspa: {
    subject: 'Your no-show rate is costing you $3,000+ a month.',
    body: (name) => `Hey ${name},

Most med spas lose 15-25% of appointments to no-shows. At an average ticket of $200-500, that's thousands in lost revenue every month.

RunBy fixes that — automatically. It sends appointment confirmations, reminders the day before, and a "running late?" text 30 minutes prior. If someone cancels, it immediately starts working through your waitlist to fill the slot.

But it does way more than that. It answers every call 24/7, books appointments, follows up with clients who haven't been in a while, and sends post-treatment review requests.

All automated. No front desk drama. No revenue walking out the door.

14-day free trial. 10-minute setup. No credit card.

Start here: ${PRICING_URL}

Jon
RunBy | Your AI Employee
${PHONE}`,
  },
  'general-contractor': {
    subject: 'You\'re losing jobs while you\'re on job sites. Here\'s the fix.',
    body: (name) => `Hey ${name},

When you're on-site managing a project, the last thing you can do is answer every call that comes in. But every missed call is a potential $5,000-50,000 project that goes to someone else.

RunBy gives you AI-powered staff that handles calls, bookings, follow-ups, and collections — 24/7. It asks the right questions — project type, timeline, location, budget — books consultations, chases invoices, and follows up with past clients.

It handles the admin so you can handle the work that actually makes money.

14-day free trial. No credit card. Takes 10 minutes to set up.

Try it free: ${PRICING_URL}

Jon
RunBy | Your AI Employee
${PHONE}`,
  },
};

const VERSION_B = {
  // Curiosity / Social Proof angle
  hvac: {
    subject: 'How one HVAC tech booked 23 extra jobs last month without answering his phone',
    body: (name) => `Hey ${name},

A one-man HVAC shop in Miami was missing about half his calls because he was always on a job. Normal stuff — you know how it goes.

He got AI-powered staff that handles his calls, bookings, follow-ups, and invoicing — 24/7 — while he works. First month: 23 additional bookings he would've lost. That's over $12,000 in revenue — from calls he wasn't even picking up before.

The tool is called RunBy. It gave him AI staff that sounds like a real person, knows his services and hours, and handles everything — calls, bookings, follow-ups, invoice reminders. His customers had no idea they weren't talking to his office.

He set it up in 10 minutes on a Tuesday.

Want to see what it does for your numbers? Free 14-day trial, no credit card.

${PRICING_URL}

Jon
RunBy | ${PHONE}`,
  },
  plumbing: {
    subject: 'This plumber added $8K/month without running a single ad',
    body: (name) => `Hey ${name},

A plumbing company in Dallas was spending $2,000/month on Google Ads. Getting plenty of calls. But when they looked at the data, they were missing 40% of them — mostly after hours and weekends.

Instead of spending more on ads, they plugged the revenue leak. They got AI-powered staff that handles every call, books jobs instantly, and follows up on invoices — 24/7.

No hiring. No training. No turnover.

Result: $8,000 in additional monthly revenue. Same ad spend. Just stopped letting calls fall through the cracks.

The tool is RunBy. 14-day free trial, no credit card, 10-minute setup.

${PRICING_URL}

Jon
RunBy | ${PHONE}`,
  },
  electrical: {
    subject: 'What would 15 extra booked jobs per month do for your business?',
    body: (name) => `Hey ${name},

Genuine question — if someone guaranteed you 15 more booked jobs per month, with zero extra advertising, what would that be worth?

For most electrical contractors, it's $7,500-15,000 in additional revenue.

Here's how it works: you're already getting those calls. They're just going to voicemail because you're in a panel box or on a ladder. 78% of those callers don't leave a message — they call the next electrician.

RunBy gives you AI staff that handles every call, books the appointment, chases invoices, and follows up — so you stop losing revenue to admin you don't have time for.

14-day free trial. No credit card. You'll see the difference in the first week.

${PRICING_URL}

Jon
RunBy | ${PHONE}`,
  },
  roofing: {
    subject: 'One roofer booked 47 inspections in 3 days after a hailstorm. Here\'s how.',
    body: (name) => `Hey ${name},

After a hailstorm in Fort Worth last spring, a roofing company got 100+ calls in 72 hours. Their office staff could handle maybe 30. The rest went to voicemail.

This year, they used RunBy — AI-powered staff that handles every call simultaneously. No hold times, no voicemail, no lost revenue.

47 inspections booked in 3 days. Every caller was handled in under 90 seconds.

You never know when the next storm hits. But when it does, the roofers who answer every call will dominate the market.

Free 14-day trial. 10-minute setup. Be ready before your competitors are.

${PRICING_URL}

Jon
RunBy | ${PHONE}`,
  },
  medspa: {
    subject: 'She cut her no-show rate from 22% to 6%. Here\'s the trick.',
    body: (name) => `Hey ${name},

A med spa owner in Scottsdale was losing $4,000+ a month to no-shows. She tried double-booking, charging cancellation fees, calling clients manually. Nothing really moved the needle.

Then she set up automated confirmations and reminders — a text when they book, an email the day before, and a "still coming?" message 30 minutes prior. If someone cancelled, her waitlist was contacted automatically.

No-show rate went from 22% to 6% in the first month. That's $3,200/month back in her pocket — without lifting a finger.

The tool is RunBy. It's AI-powered staff that also handles every call, books appointments 24/7, chases invoices, and follows up with clients who haven't been in a while.

14-day free trial. No credit card. 10-minute setup.

${PRICING_URL}

Jon
RunBy | ${PHONE}`,
  },
  'general-contractor': {
    subject: 'How a GC landed a $40K project from a call he never answered',
    body: (name) => `Hey ${name},

A general contractor in Atlanta was on-site managing a kitchen remodel when a property manager called about a $40K commercial buildout. He couldn't pick up. Normally, that call goes to voicemail and the PM calls the next contractor on their list.

But he'd set up RunBy the week before. His AI answered the call, had a natural conversation about the project scope, gathered the details, and booked a consultation on his calendar. The PM got a confirmation text 10 seconds later.

He didn't even know the call happened until he got the alert. Closed the deal the following week.

That's RunBy. AI-powered staff that handles calls, bookings, follow-ups, and collections — 24/7 — so no opportunity or dollar slips through while you're doing actual work.

14-day free trial. No credit card. 10-minute setup.

${PRICING_URL}

Jon
RunBy | ${PHONE}`,
  },
};

// ── Follow-Up Templates ──

const FOLLOW_UPS = {
  3: {
    subject: 'quick follow up ↓',
    body: (name, vertical) => `Hey ${name},

Just bumping this in case it got buried. I know you're busy running jobs.

Short version: RunBy gives you AI-powered staff that handles calls, bookings, follow-ups, and collections — 24/7 — for a fraction of one employee. 14-day free trial.

Worth 10 minutes to try? ${PRICING_URL}

Jon`,
  },
  7: {
    subject: 're: missed calls',
    body: (name, vertical) => {
      const verticalLabel = {
        hvac: 'HVAC', plumbing: 'plumbing', electrical: 'electrical',
        roofing: 'roofing', medspa: 'med spa', 'general-contractor': 'GC',
      }[vertical] || 'service';
      return `Hey ${name},

Last one from me — just wanted to make sure this crossed your radar.

If you're spending hours every week on admin — returning calls, chasing invoices, confirming appointments — RunBy handles all of it. AI-powered staff that runs your operations while you do actual work. You see it all in a daily report.

14-day free trial: ${PRICING_URL}

If the timing isn't right, no worries at all. But the trial is free and takes 10 minutes — most owners see results in the first 48 hours.

Jon
${PHONE}`;
    },
  },
  14: {
    subject: 'should I close your file?',
    body: (name, vertical) => `Hey ${name},

I've reached out a few times and haven't heard back — totally understand, you're running a business.

I'll close out your file for now, but if you ever want to stop losing revenue to admin work and get AI-powered staff running your operations, here's where to start:

${PRICING_URL}

14-day free trial. 10 minutes to set up. No strings.

Wishing you a great rest of the year.

Jon
RunBy | ${PHONE}`,
  },
};

// ── HTML Email Wrapper ──
function wrapHtml(textBody, email) {
  const htmlBody = textBody
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color: #e94560; text-decoration: none; font-weight: 600;">$1</a>')
    .replace(/\(786\) 733-2209/g, '<a href="tel:+17867332209" style="color: #e94560; text-decoration: none;">(786) 733-2209</a>')
    .replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f4f4f8; font-family: 'Helvetica Neue', Arial, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 24px;">
    <div style="font-size: 15px; line-height: 1.7; color: #333333;">
      ${htmlBody}
    </div>
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #999;">
      <p>RunBy, Inc. | Miami, FL 33101</p>
      <p><a href="{{unsubscribe_url}}" style="color: #999;">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ── Main Send Function ──
async function sendCampaign(leadsFile) {
  // Parse CSV
  const csv = fs.readFileSync(leadsFile, 'utf8').trim();
  const lines = csv.split('\n');
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  const leads = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const lead = {};
    headers.forEach((h, i) => lead[h] = vals[i] || '');
    return lead;
  });

  console.log(`[Campaign] Loaded ${leads.length} leads from ${leadsFile}`);

  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const campaignLogs = readCampaignLog();

  let sent = 0, failed = 0, skipped = 0;

  for (const lead of leads) {
    const { first_name, email, business_name, vertical } = lead;

    if (!email || !vertical) {
      console.warn(`[Campaign] Skipping lead — missing email or vertical: ${JSON.stringify(lead)}`);
      skipped++;
      continue;
    }

    // Check if already sent (local campaign log)
    const existing = campaignLogs.find(l =>
      l.recipient_email === email && l.step === 'initial'
    );

    if (existing) {
      console.log(`[Campaign] Already sent to ${email}, skipping`);
      skipped++;
      continue;
    }

    const version = assignVersion(email);
    const templates = version === 'A' ? VERSION_A : VERSION_B;
    const template = templates[vertical] || templates['general-contractor'];
    const name = first_name || 'there';

    try {
      const textBody = template.body(name);

      await sgMail.send({
        to: email,
        from: { email: process.env.SENDGRID_FROM_EMAIL || 'jonathan@runbyai.co', name: 'Jon from RunBy' },
        replyTo: 'jonathan@runbyai.co',
        subject: template.subject,
        text: textBody,
        html: wrapHtml(textBody, email),
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true },
        },
      });

      // Log to Supabase
      appendCampaignLog({
        sent_at: new Date().toISOString(),
        recipient_email: email,
        step: 'initial',
        version,
        vertical,
        business_name: business_name || '',
        subject: template.subject,
        delivery_status: 'sent',
      });

      sent++;
      console.log(`[Campaign] ✓ Sent to ${email} (Version ${version}, ${vertical})`);

      // Rate limit: 2-second delay between sends
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      failed++;
      console.error(`[Campaign] ✗ Failed ${email}: ${err.message}`);
    }
  }

  console.log(`\n[Campaign] Complete: ${sent} sent, ${failed} failed, ${skipped} skipped`);
  return { sent, failed, skipped };
}

// ── Follow-Up Sender ──
async function sendFollowUps(days, force = false) {
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  const campaignLogs = readCampaignLog();

  const template = FOLLOW_UPS[days];
  if (!template) {
    console.error(`[Campaign] No follow-up template for day ${days}. Available: 3, 7, 14`);
    return;
  }

  // Find leads who received initial email N+ days ago but haven't received this follow-up
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  let initialSends = campaignLogs
    .filter(log => log.step === 'initial')
    .filter(log => new Date(log.sent_at || 0) <= cutoffDate);

  if (force) {
    initialSends = campaignLogs.filter(log => log.step === 'initial');
    console.log(`[Campaign] Force mode enabled — ignoring ${days}-day wait window`);
  }

  if (!initialSends || initialSends.length === 0) {
    console.log(`[Campaign] No leads eligible for Day ${days} follow-up`);
    return;
  }

  // Filter: only those with step='initial' and no existing follow-up at this day
  const eligible = [];
  for (const send of initialSends) {
    const followUpExists = campaignLogs.find(log =>
      log.recipient_email === send.recipient_email &&
      log.step === `follow_up_${days}`
    );

    if (!followUpExists) {
      eligible.push(send);
    }
  }

  console.log(`[Campaign] ${eligible.length} leads eligible for Day ${days} follow-up`);

  let sent = 0, failed = 0;

  for (const lead of eligible) {
    const email = lead.recipient_email;
    const vertical = lead.vertical || 'general-contractor';
    const version = lead.version || assignVersion(email);
    const name = 'there';

    try {
      const textBody = template.body(name, vertical);

      await sgMail.send({
        to: email,
        from: { email: process.env.SENDGRID_FROM_EMAIL || 'jonathan@runbyai.co', name: 'Jon from RunBy' },
        replyTo: 'jonathan@runbyai.co',
        subject: template.subject,
        text: textBody,
        html: wrapHtml(textBody, email),
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true },
        },
      });

      appendCampaignLog({
        sent_at: new Date().toISOString(),
        recipient_email: email,
        step: `follow_up_${days}`,
        version,
        vertical,
        subject: template.subject,
        delivery_status: 'sent',
      });

      sent++;
      console.log(`[Campaign] ✓ Day ${days} follow-up sent to ${email}`);
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      failed++;
      console.error(`[Campaign] ✗ Follow-up failed ${email}: ${err.message}`);
    }
  }

  console.log(`\n[Campaign] Day ${days} follow-ups: ${sent} sent, ${failed} failed`);
}

// ── Campaign Stats ──
async function showStats() {
  const logs = readCampaignLog().sort((a, b) => {
    return new Date(a.sent_at || 0) - new Date(b.sent_at || 0);
  });

  if (!logs || logs.length === 0) {
    console.log('[Campaign] No sends yet for this campaign.');
    return;
  }

  const stats = { A: {}, B: {} };
  const verticalStats = {};

  for (const log of logs) {
    const v = log.version || 'A';
    const vert = log.vertical || 'unknown';
    const step = log.step || 'initial';

    if (!stats[v][step]) stats[v][step] = { sent: 0 };
    stats[v][step].sent++;

    if (!verticalStats[vert]) verticalStats[vert] = { A: 0, B: 0 };
    if (step === 'initial') verticalStats[vert][v]++;
  }

  console.log('\n========================================');
  console.log(`  Campaign: ${CAMPAIGN_ID}`);
  console.log('========================================');
  console.log(`  Total sends: ${logs.length}`);

  for (const version of ['A', 'B']) {
    console.log(`\n  Version ${version} (${version === 'A' ? 'Pain Point' : 'Social Proof'}):`);
    for (const [step, data] of Object.entries(stats[version] || {})) {
      console.log(`    ${step}: ${data.sent} sent`);
    }
  }

  console.log('\n  By Vertical:');
  for (const [vert, data] of Object.entries(verticalStats)) {
    console.log(`    ${vert}: ${data.A} (A) / ${data.B} (B)`);
  }

  console.log('\n  Note: Open/click tracking requires SendGrid Event Webhook');
  console.log('  Set up at: https://app.sendgrid.com/settings/mail_settings');
  console.log('========================================\n');
}

// ── CLI ──
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    return showStats();
  }

  if (args.includes('--follow-up')) {
    const daysIdx = args.indexOf('--days');
    const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : null;
    const force = args.includes('--force');
    if (!days || ![3, 7, 14].includes(days)) {
      console.error('Usage: node core/email-campaign.js --follow-up --days <3|7|14>');
      process.exit(1);
    }
    return sendFollowUps(days, force);
  }

  const fileIdx = args.indexOf('--file');
  if (fileIdx < 0 || !args[fileIdx + 1]) {
    console.error('Usage: node core/email-campaign.js --file <leads.csv>');
    console.error('       node core/email-campaign.js --follow-up --days <3|7|14> [--force]');
    console.error('       node core/email-campaign.js --stats');
    process.exit(1);
  }

  return sendCampaign(args[fileIdx + 1]);
}

main().catch(err => {
  console.error('[Campaign] Fatal error:', err.message);
  process.exit(1);
});
