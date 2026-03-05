// core/scheduler.js
// Daily cron jobs: check-in emails, invoice reminders, seasonal reminders

require('dotenv').config();
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { sendCheckInEmail, sendInvoiceReminderEmail, sendSeasonalReminderEmail } = require('./email-sender');
const { markOverdueInvoices } = require('./invoice-handler');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * JOB 1: Check-in emails (daily at 8:00 AM)
 * Send follow-up emails to customers 3 days after their service is marked completed
 */
cron.schedule('0 8 * * *', async () => {
  console.log('[Scheduler] Starting check-in email job...');
  try {
    // Get the date 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoISO = threeDaysAgo.toISOString();

    // Query bookings that are completed 3+ days ago and haven't been followed up
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        id,
        customer_email,
        customer_name,
        service_type,
        completed_at,
        client:clients(id, business_name, client_config)
      `)
      .eq('status', 'completed')
      .lte('completed_at', threeDaysAgoISO)
      .is('follow_up_sent_at', null)
      .not('customer_email', 'is', null);

    if (error) {
      console.error('[Scheduler] Check-in query error:', error.message);
      return;
    }

    if (!bookings || bookings.length === 0) {
      console.log('[Scheduler] No check-in emails to send');
      return;
    }

    let sent = 0;
    for (const booking of bookings) {
      try {
        const clientData = Array.isArray(booking.client) ? booking.client[0] : booking.client;
        const config = clientData?.client_config || {};
        const review_url = config.review_url || '#';

        await sendCheckInEmail({
          to: booking.customer_email,
          customer_name: booking.customer_name,
          service_type: booking.service_type,
          booking_id: booking.id,
          client_id: clientData?.id,
          business_name: clientData?.business_name,
          review_url,
        });

        // Mark follow-up as sent
        await supabase
          .from('bookings')
          .update({ follow_up_sent_at: new Date().toISOString() })
          .eq('id', booking.id);

        sent++;
      } catch (err) {
        console.error(`[Scheduler] Error sending check-in for booking ${booking.id}:`, err.message);
      }
    }

    console.log(`[Scheduler] Check-in emails: sent ${sent} of ${bookings.length}`);
  } catch (err) {
    console.error('[Scheduler] Check-in job error:', err.message);
  }
});

/**
 * JOB 2: Invoice reminders (daily at 8:15 AM)
 * Send reminder emails for overdue invoices at 3, 7, and 14 day milestones
 */
cron.schedule('15 8 * * *', async () => {
  console.log('[Scheduler] Starting invoice reminder job...');
  try {
    // First, mark any pending invoices that are now overdue
    const markResult = await markOverdueInvoices();
    console.log(`[Scheduler] Marked ${markResult.updated} invoices as overdue`);

    // Query all overdue invoices with customer email
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select(`
        id,
        external_invoice_id,
        customer_name,
        customer_email,
        customer_phone,
        amount,
        due_date,
        status,
        client:clients(id, business_name, owner_email)
      `)
      .eq('status', 'overdue')
      .not('customer_email', 'is', null);

    if (error) {
      console.error('[Scheduler] Invoice query error:', error.message);
      return;
    }

    if (!invoices || invoices.length === 0) {
      console.log('[Scheduler] No invoice reminders to send');
      return;
    }

    let sent = 0;
    for (const invoice of invoices) {
      try {
        const clientData = Array.isArray(invoice.client) ? invoice.client[0] : invoice.client;

        // Calculate days overdue
        const dueDate = new Date(invoice.due_date);
        const today = new Date();
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

        // Determine which milestone(s) should trigger an email
        let shouldSend = false;
        let milestone = null;

        if (daysOverdue === 3) {
          milestone = 3;
          shouldSend = true;
        } else if (daysOverdue === 7) {
          milestone = 7;
          shouldSend = true;
        } else if (daysOverdue === 14) {
          milestone = 14;
          shouldSend = true;
        } else if (daysOverdue > 14) {
          // For invoices over 14 days, check if we've already sent at 14 days
          const { data: existingLogs } = await supabase
            .from('email_logs')
            .select('id')
            .eq('related_invoice_id', invoice.external_invoice_id)
            .eq('email_type', 'invoice-reminder')
            .limit(1);

          // Only send if no reminders exist yet for this invoice
          shouldSend = !existingLogs || existingLogs.length === 0;
        }

        if (shouldSend) {
          await sendInvoiceReminderEmail({
            to: invoice.customer_email,
            customer_name: invoice.customer_name,
            invoice_id: invoice.external_invoice_id,
            amount: invoice.amount,
            due_date: invoice.due_date,
            days_overdue: daysOverdue,
            client_id: clientData?.id,
            business_name: clientData?.business_name,
            owner_email: clientData?.owner_email,
          });

          sent++;
        }
      } catch (err) {
        console.error(`[Scheduler] Error sending invoice reminder for ${invoice.id}:`, err.message);
      }
    }

    console.log(`[Scheduler] Invoice reminders: sent ${sent} of ${invoices.length}`);
  } catch (err) {
    console.error('[Scheduler] Invoice reminder job error:', err.message);
  }
});

/**
 * JOB 3: Seasonal reminders (daily at 8:30 AM)
 * Send proactive seasonal maintenance reminders to past customers
 */
cron.schedule('30 8 * * *', async () => {
  console.log('[Scheduler] Starting seasonal reminder job...');
  try {
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const currentYear = new Date().getFullYear();

    // Query seasonal reminders enabled for this month
    const { data: seasonalReminders, error } = await supabase
      .from('seasonal_reminders')
      .select(`
        id,
        client_id,
        reminder_key,
        reminder_label,
        service_description,
        reminder_month,
        last_sent_at,
        client:clients(id, business_name, booking_phone)
      `)
      .eq('enabled', true)
      .eq('reminder_month', currentMonth);

    if (error) {
      console.error('[Scheduler] Seasonal reminders query error:', error.message);
      return;
    }

    if (!seasonalReminders || seasonalReminders.length === 0) {
      console.log('[Scheduler] No seasonal reminders for this month');
      return;
    }

    let sent = 0;
    for (const reminder of seasonalReminders) {
      try {
        // Check if already sent this year
        if (reminder.last_sent_at) {
          const lastSentYear = new Date(reminder.last_sent_at).getFullYear();
          if (lastSentYear === currentYear) {
            console.log(`[Scheduler] Seasonal reminder ${reminder.id} already sent this year`);
            continue;
          }
        }

        const clientData = Array.isArray(reminder.client) ? reminder.client[0] : reminder.client;

        // Get unique customer emails from recent bookings (last 12 months)
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const { data: recentBookings, error: bookingError } = await supabase
          .from('bookings')
          .select('customer_email')
          .eq('client_id', reminder.client_id)
          .gte('created_at', oneYearAgo.toISOString())
          .not('customer_email', 'is', null);

        if (bookingError) {
          console.error(`[Scheduler] Error fetching bookings for reminder ${reminder.id}:`, bookingError.message);
          continue;
        }

        if (!recentBookings || recentBookings.length === 0) {
          console.log(`[Scheduler] No recent bookings for client ${reminder.client_id}`);
          continue;
        }

        // Deduplicate emails
        const uniqueEmails = [...new Set(recentBookings.map(b => b.customer_email))];

        // Send to each unique customer
        for (const customerEmail of uniqueEmails) {
          try {
            await sendSeasonalReminderEmail({
              to: customerEmail,
              customer_name: 'Valued Customer',
              service_description: reminder.service_description,
              client_id: reminder.client_id,
              business_name: clientData?.business_name,
              booking_phone: clientData?.booking_phone,
            });

            sent++;
          } catch (err) {
            console.error(`[Scheduler] Error sending seasonal reminder to ${customerEmail}:`, err.message);
          }
        }

        // Update last_sent_at
        await supabase
          .from('seasonal_reminders')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('id', reminder.id);
      } catch (err) {
        console.error(`[Scheduler] Error processing seasonal reminder ${reminder.id}:`, err.message);
      }
    }

    console.log(`[Scheduler] Seasonal reminders: sent ${sent} emails`);
  } catch (err) {
    console.error('[Scheduler] Seasonal reminder job error:', err.message);
  }
});

console.log('[Scheduler] Cron jobs initialized');
