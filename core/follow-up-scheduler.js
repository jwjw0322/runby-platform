const cron = require('node-cron');
const { supabase } = require('./supabase');
const { sendEmail } = require('./email-sender');

/**
 * Follow-up Email Scheduler
 * 
 * Runs every 30 minutes to check for completed bookings that haven't received
 * follow-up emails yet, and sends automated follow-up messages (surveys, reviews, upsells).
 */

async function sendFollowUpEmails() {
  try {
    console.log('[Follow-up Scheduler] Checking for completed bookings...');

    // Query bookings that are completed but haven't received follow-up emails
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, client_email, service_type, completed_at, follow_up_sent_at')
      .not('completed_at', 'is', null)
      .is('follow_up_sent_at', null);

    if (error) {
      console.error('[Follow-up Scheduler] Error querying bookings:', error);
      return;
    }

    if (!bookings || bookings.length === 0) {
      console.log('[Follow-up Scheduler] No completed bookings pending follow-up.');
      return;
    }

    console.log(`[Follow-up Scheduler] Found ${bookings.length} booking(s) needing follow-up.`);

    for (const booking of bookings) {
      try {
        await sendFollowUpEmail(booking);
      } catch (emailError) {
        console.error(`[Follow-up Scheduler] Failed to send follow-up for booking ${booking.id}:`, emailError);
      }
    }

  } catch (err) {
    console.error('[Follow-up Scheduler] Unexpected error:', err);
  }
}

async function sendFollowUpEmail(booking) {
  const { id, client_email, service_type } = booking;

  // Build follow-up email content based on service type
  const subject = `We'd love your feedback on your ${service_type} service`;
  const htmlContent = `
    <h2>Thank You for Using Our Service</h2>
    <p>Hi there,</p>
    <p>We hope you're satisfied with your recent ${service_type} service. Your feedback helps us serve you better!</p>
    <p>
      <a href="https://example.com/survey?booking_id=${id}" style="background-color: #1D4ED8; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
        Leave a Review
      </a>
    </p>
    <p>Best regards,<br/>Your Service Team</p>
  `;

  // Send the email
  await sendEmail({
    to: client_email,
    subject,
    html: htmlContent,
  });

  // Update follow_up_sent_at timestamp
  const { error: updateError } = await supabase
    .from('bookings')
    .update({ follow_up_sent_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) {
    throw new Error(`Failed to update follow_up_sent_at for booking ${id}: ${updateError.message}`);
  }

  console.log(`[Follow-up Scheduler] Follow-up email sent for booking ${id}.`);
}

/**
 * Initialize the scheduler
 * Runs every 30 minutes (at minute 0 and 30 of each hour)
 */
function initFollowUpScheduler() {
  console.log('[Follow-up Scheduler] Initializing follow-up email scheduler...');

  // Schedule task to run every 30 minutes
  const task = cron.schedule('*/30 * * * *', sendFollowUpEmails);

  console.log('[Follow-up Scheduler] Scheduler initialized. Will check for follow-ups every 30 minutes.');

  return task;
}

// Export for use in main server
module.exports = {
  initFollowUpScheduler,
  sendFollowUpEmails,
};
