// core/email-sender.js
// Sends emails via SendGrid (confirmations, owner alerts, calendar invites, follow-ups)

require('dotenv').config();

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

/**
 * Generate an .ics calendar invite string
 */
function generateICS({ customer_name, service_type, date, time, address, booking_id, business_name }) {
  // Parse date and time into a proper datetime
  const [year, month, day] = date.split('-');
  // Convert time like "9:00 AM" to 24h format
  let [timePart, ampm] = time.split(' ');
  let [hours, minutes] = timePart.split(':').map(Number);
  if (ampm && ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
  if (ampm && ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;

  const startHour = String(hours).padStart(2, '0');
  const startMin = String(minutes || 0).padStart(2, '0');
  const endHours = String(hours + 2).padStart(2, '0'); // 2-hour appointment

  const dtStart = `${year}${month}${day}T${startHour}${startMin}00`;
  const dtEnd = `${year}${month}${day}T${endHours}${startMin}00`;
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${business_name || 'RunBy Client'}//RunBy//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `DTSTART;TZID=America/New_York:${dtStart}`,
    `DTEND;TZID=America/New_York:${dtEnd}`,
    `DTSTAMP:${now}`,
    `UID:${booking_id}@runby-platform`,
    `SUMMARY:${service_type} — ${customer_name}`,
    `DESCRIPTION:Service: ${service_type}\\nCustomer: ${customer_name}\\nAddress: ${address || 'TBD'}\\nRef: ${booking_id.slice(0, 8).toUpperCase()}`,
    `LOCATION:${address || 'TBD'}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/**
 * Send a booking confirmation email to the customer (with calendar invite)
 */
async function sendConfirmationEmail({ to, customer_name, service_type, date, time, address, booking_id, business_name }) {
  business_name = business_name || 'the company';
  const refCode = booking_id.slice(0, 8).toUpperCase();

  // Generate calendar invite
  const icsContent = generateICS({ customer_name, service_type, date, time, address, booking_id, business_name });
  const icsBase64 = Buffer.from(icsContent).toString('base64');

  const emailContent = {
    personalizations: [
      {
        to: [{ email: to }],
        subject: `Appointment Confirmed — ${service_type} on ${date}`,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: business_name,
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1a56db; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0;">${business_name}</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <h2 style="color: #1a56db;">Appointment Confirmed!</h2>
              <p>Hi ${customer_name},</p>
              <p>Your appointment has been scheduled. Here are the details:</p>
              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; width: 120px;"><strong>Service:</strong></td>
                    <td style="padding: 8px 0;">${service_type}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Date:</strong></td>
                    <td style="padding: 8px 0;">${date}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Time:</strong></td>
                    <td style="padding: 8px 0;">${time}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Address:</strong></td>
                    <td style="padding: 8px 0;">${address || 'On file'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Reference:</strong></td>
                    <td style="padding: 8px 0;">${refCode}</td>
                  </tr>
                </table>
              </div>
              <p><strong>What to expect:</strong></p>
              <p>Our technician will arrive during the scheduled time window. Please make sure someone 18 or older is present at the property.</p>
              <p><strong>Need to reschedule?</strong></p>
              <p>Call us at ${process.env.TWILIO_PHONE_NUMBER || '(786) 755-3244'} and reference booking ${refCode}.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                ${business_name}<br>
                Licensed & Insured
              </p>
            </div>
          </div>
        `,
      },
    ],
    attachments: [
      {
        content: icsBase64,
        filename: 'appointment.ics',
        type: 'text/calendar',
        disposition: 'attachment',
      },
    ],
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

  console.log(`[Email] Confirmation + calendar invite sent to ${to}`);
  return true;
}

/**
 * Send a notification email to the business owner when a new booking is created
 */
async function sendOwnerNotification({ customer_name, customer_phone, customer_email, customer_address, service_type, date, time, booking_id, notes, business_name, owner_email }) {
  const ownerEmail = owner_email || process.env.OWNER_EMAIL;
  business_name = business_name || 'the company';
  if (!ownerEmail) {
    console.log('[Email] No owner_email provided and no OWNER_EMAIL in .env — skipping owner notification');
    return false;
  }

  const refCode = booking_id.slice(0, 8).toUpperCase();

  // Generate calendar invite for owner too
  const icsContent = generateICS({ customer_name, service_type, date, time, address: customer_address, booking_id, business_name });
  const icsBase64 = Buffer.from(icsContent).toString('base64');

  const emailContent = {
    personalizations: [
      {
        to: [{ email: ownerEmail }],
        subject: `New Booking: ${service_type} — ${customer_name} on ${date} at ${time}`,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: `RunBy AI — ${business_name}`,
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #059669; color: white; padding: 15px 20px;">
              <h2 style="margin: 0;">New Appointment Booked</h2>
            </div>
            <div style="padding: 25px; background: #f9fafb;">
              <p>A new appointment was just booked by the AI receptionist:</p>
              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 15px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280; width: 130px;"><strong>Customer:</strong></td>
                    <td style="padding: 8px 0;">${customer_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Phone:</strong></td>
                    <td style="padding: 8px 0;"><a href="tel:${customer_phone}">${customer_phone}</a></td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Email:</strong></td>
                    <td style="padding: 8px 0;">${customer_email || 'Not provided'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Address:</strong></td>
                    <td style="padding: 8px 0;">${customer_address || 'Not provided'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Service:</strong></td>
                    <td style="padding: 8px 0; font-weight: bold;">${service_type}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Date:</strong></td>
                    <td style="padding: 8px 0; font-weight: bold;">${date}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Time:</strong></td>
                    <td style="padding: 8px 0; font-weight: bold;">${time}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Reference:</strong></td>
                    <td style="padding: 8px 0;">${refCode}</td>
                  </tr>
                  ${notes ? `<tr><td style="padding: 8px 0; color: #6b7280;"><strong>Notes:</strong></td><td style="padding: 8px 0;">${notes}</td></tr>` : ''}
                </table>
              </div>
              <p style="color: #6b7280; font-size: 13px;">This booking was created automatically by the RunBy AI receptionist. The calendar invite is attached — open it to add to your calendar.</p>
            </div>
          </div>
        `,
      },
    ],
    attachments: [
      {
        content: icsBase64,
        filename: 'appointment.ics',
        type: 'text/calendar',
        disposition: 'attachment',
      },
    ],
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
    throw new Error(`SendGrid owner notification error ${response.status}: ${errorBody}`);
  }

  console.log(`[Email] Owner notification sent to ${ownerEmail}`);
  return true;
}

/**
 * Send a follow-up email after service
 */
async function sendFollowUpEmail({ to, customer_name, service_type, business_name }) {
  business_name = business_name || 'the company';
  const emailContent = {
    personalizations: [
      {
        to: [{ email: to }],
        subject: `How was your ${service_type} service? — ${business_name}`,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: business_name,
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
            <h2>Hi ${customer_name},</h2>
            <p>We hope your recent ${service_type} service went well!</p>
            <p>If you have a moment, we'd really appreciate a Google review. It helps other homeowners find reliable service.</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="https://g.page/review/YOUR_GOOGLE_REVIEW_LINK"
                 style="background: #1a56db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Leave a Review
              </a>
            </p>
            <p>Thank you for choosing ${business_name}!</p>
            <p style="color: #9ca3af; font-size: 12px;">
              If anything wasn't up to your expectations, please call us at ${process.env.TWILIO_PHONE_NUMBER || '(786) 755-3244'}
              so we can make it right.
            </p>
          </div>
        `,
      },
    ],
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

  console.log(`[Email] Follow-up sent to ${to}`);
  return true;
}

/**
 * Send onboarding notification email to admin (Jon)
 * Called after a new business owner completes the voice onboarding call
 */
async function sendOnboardingNotification({
  onboarding_request_id,
  business_name,
  owner_name,
  owner_email,
  owner_phone,
  vertical_id,
  service_area,
  services,
  business_hours,
  ai_name,
  timezone,
  preferred_area_code,
}) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'jonathan.williams0322@gmail.com';

  const servicesStr = Array.isArray(services) ? services.join(', ') : services;

  const emailContent = {
    personalizations: [
      {
        to: [{ email: adminEmail }],
        subject: `New Onboarding Request: ${business_name} (${vertical_id})`,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: 'RunBy Onboarding',
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
            <div style="background: #0066cc; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0;">New Client Onboarding Request</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>A new business owner just completed the voice onboarding call. Review the details below and run the provisioning script when ready.</p>

              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h2 style="color: #0066cc; margin-top: 0;">Business Information</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold; width: 160px;">Business Name:</td>
                    <td style="padding: 10px 0; font-size: 16px;">${business_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Vertical:</td>
                    <td style="padding: 10px 0; text-transform: capitalize;">${vertical_id}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Service Area:</td>
                    <td style="padding: 10px 0;">${service_area}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Services Offered:</td>
                    <td style="padding: 10px 0;">${servicesStr}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Business Hours:</td>
                    <td style="padding: 10px 0;">${business_hours}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">AI Name:</td>
                    <td style="padding: 10px 0;">${ai_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Timezone:</td>
                    <td style="padding: 10px 0;">${timezone}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Preferred Area Code:</td>
                    <td style="padding: 10px 0;">${preferred_area_code || 'No preference'}</td>
                  </tr>
                </table>

                <h2 style="color: #0066cc; margin-top: 25px;">Owner Contact</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold; width: 160px;">Owner Name:</td>
                    <td style="padding: 10px 0;">${owner_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Owner Email:</td>
                    <td style="padding: 10px 0;"><a href="mailto:${owner_email}">${owner_email}</a></td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Owner Phone:</td>
                    <td style="padding: 10px 0;"><a href="tel:${owner_phone}">${owner_phone}</a></td>
                  </tr>
                </table>
              </div>

              <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <strong>Next Steps:</strong> Review the info above, then run <code>node core/onboard-client.js</code> to provision this client (buy number, create DB records, import to Vapi).
              </div>

              <p style="color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 15px; margin-top: 30px;">
                Request ID: ${onboarding_request_id}<br>
                Received: ${new Date().toLocaleString()}
              </p>
            </div>
          </div>
        `,
      },
    ],
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
    throw new Error(`SendGrid onboarding notification error ${response.status}: ${errorBody}`);
  }

  console.log(`[Email] Onboarding notification sent to ${adminEmail}`);
  return true;
}

/**
 * Send demo booking notification email to admin
 * Called after the sales AI books a demo with a prospect
 */
async function sendDemoNotification({
  demo_lead_id,
  business_name,
  contact_name,
  contact_email,
  contact_phone,
  business_type,
  num_employees,
  current_pain_points,
  interest_level,
  preferred_demo_time,
  timezone,
  call_direction,
}) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.OWNER_EMAIL || 'jonathan.williams0322@gmail.com';

  // Interest level badge colors
  const interestColors = { hot: '#DC2626', warm: '#F59E0B', cold: '#6B7280' };
  const interestColor = interestColors[interest_level] || interestColors.warm;

  // Call direction badge
  const directionBadge = call_direction === 'outbound'
    ? '<span style="background:#7C3AED;color:white;padding:2px 8px;border-radius:4px;font-size:12px;">OUTBOUND</span>'
    : '<span style="background:#0066CC;color:white;padding:2px 8px;border-radius:4px;font-size:12px;">INBOUND</span>';

  const emailContent = {
    personalizations: [
      {
        to: [{ email: adminEmail }],
        subject: `New Demo Booking: ${business_name} (${interest_level}) ${call_direction === 'outbound' ? '[Outbound]' : ''}`,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: 'RunBy Sales',
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
            <div style="background: #1E40AF; color: white; padding: 20px; text-align: center;">
              <h1 style="margin: 0;">New Demo Booked!</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>The AI sales rep just booked a demo meeting. ${directionBadge} <span style="background:${interestColor};color:white;padding:2px 8px;border-radius:4px;font-size:12px;">${(interest_level || 'warm').toUpperCase()}</span></p>

              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <h2 style="color: #1E40AF; margin-top: 0;">Contact Details</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold; width: 160px;">Name:</td>
                    <td style="padding: 10px 0; font-size: 16px;">${contact_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Email:</td>
                    <td style="padding: 10px 0;"><a href="mailto:${contact_email}">${contact_email}</a></td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Phone:</td>
                    <td style="padding: 10px 0;"><a href="tel:${contact_phone}">${contact_phone}</a></td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Business:</td>
                    <td style="padding: 10px 0; font-weight: bold;">${business_name}</td>
                  </tr>
                  ${business_type ? `<tr><td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Type:</td><td style="padding: 10px 0; text-transform: capitalize;">${business_type}</td></tr>` : ''}
                  ${num_employees ? `<tr><td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Team Size:</td><td style="padding: 10px 0;">${num_employees}</td></tr>` : ''}
                </table>

                <h2 style="color: #1E40AF; margin-top: 25px;">Demo Details</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold; width: 160px;">Preferred Time:</td>
                    <td style="padding: 10px 0; font-weight: bold; font-size: 16px;">${preferred_demo_time || 'Not specified'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Timezone:</td>
                    <td style="padding: 10px 0;">${timezone || 'Not specified'}</td>
                  </tr>
                  ${current_pain_points ? `<tr><td style="padding: 10px 0; color: #6b7280; font-weight: bold;">Pain Points:</td><td style="padding: 10px 0;">${current_pain_points}</td></tr>` : ''}
                </table>
              </div>

              <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <strong>Action needed:</strong> Reach out to ${contact_name} to confirm the demo time and send a calendar invite.
              </div>

              <p style="color: #6b7280; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 15px; margin-top: 30px;">
                Lead ID: ${demo_lead_id}<br>
                Received: ${new Date().toLocaleString()}
              </p>
            </div>
          </div>
        `,
      },
    ],
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
    throw new Error(`SendGrid demo notification error ${response.status}: ${errorBody}`);
  }

  console.log(`[Email] Demo booking notification sent to ${adminEmail}`);
  return true;
}

/**
 * Log an automated email to the email_logs table
 */
async function logEmail({ client_id, recipient_email, email_type, related_booking_id, related_invoice_id, subject, delivery_status }) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    await supabase.from('email_logs').insert({
      client_id,
      recipient_email,
      email_type,
      related_booking_id: related_booking_id || null,
      related_invoice_id: related_invoice_id || null,
      subject,
      delivery_status: delivery_status || 'sent',
    });
  } catch (err) {
    console.error('[Email] Failed to log email:', err.message);
  }
}

/**
 * Send a check-in email asking for a review (3 days after service)
 */
async function sendCheckInEmail({ to, customer_name, service_type, booking_id, client_id, business_name, review_url }) {
  business_name = business_name || 'the company';
  const subject = `How was your ${service_type} service? — ${business_name}`;

  const emailContent = {
    personalizations: [
      {
        to: [{ email: to }],
        subject,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: business_name,
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1a56db; color: white; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">We'd love your feedback!</h2>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>Hi ${customer_name},</p>
              <p>We hope your recent ${service_type} service went well!</p>
              <p>If you have a moment, we'd really appreciate a review. Your feedback helps us improve and also helps other customers find reliable service.</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${review_url || '#'}"
                   style="background: #1a56db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Leave a Review
                </a>
              </p>
              <p>Thank you for choosing ${business_name}!</p>
              <p style="color: #9ca3af; font-size: 12px;">
                If anything wasn't up to your expectations, please call us immediately so we can make it right.
              </p>
            </div>
          </div>
        `,
      },
    ],
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
    throw new Error(`SendGrid check-in email error ${response.status}: ${errorBody}`);
  }

  console.log(`[Email] Check-in email sent to ${to}`);
  await logEmail({
    client_id,
    recipient_email: to,
    email_type: 'check-in',
    related_booking_id: booking_id,
    subject,
    delivery_status: 'sent',
  });
  return true;
}

/**
 * Send an invoice reminder email with escalating tone based on days overdue
 */
async function sendInvoiceReminderEmail({ to, customer_name, invoice_id, amount, due_date, days_overdue, client_id, business_name, owner_email }) {
  business_name = business_name || 'the company';

  let subject, greeting, body;

  if (days_overdue <= 3) {
    subject = `Just a friendly reminder: Invoice ${invoice_id} due from ${business_name}`;
    greeting = `Hi ${customer_name},`;
    body = `We hope you've been satisfied with our service. Just a friendly reminder that your invoice is due.`;
  } else if (days_overdue <= 7) {
    subject = `Your invoice is now ${days_overdue} days past due — ${business_name}`;
    greeting = `Hi ${customer_name},`;
    body = `Your invoice is now ${days_overdue} days past due. We would appreciate payment at your earliest convenience.`;
  } else {
    subject = `URGENT: Outstanding balance from ${business_name}`;
    greeting = `${customer_name},`;
    body = `This is an urgent reminder regarding your outstanding balance of $${amount.toFixed(2)}. This invoice is now ${days_overdue} days overdue. Please remit payment immediately.`;
  }

  const emailContent = {
    personalizations: [
      {
        to: [{ email: to }],
        subject,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: business_name,
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${days_overdue >= 14 ? '#DC2626' : days_overdue >= 7 ? '#F59E0B' : '#1a56db'}; color: white; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">Invoice Reminder</h2>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>${greeting}</p>
              <p>${body}</p>
              <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Invoice #:</strong></td>
                    <td style="padding: 8px 0; text-align: right; font-weight: bold;">${invoice_id}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Amount Due:</strong></td>
                    <td style="padding: 8px 0; text-align: right; font-weight: bold; font-size: 18px;">$${amount.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;"><strong>Due Date:</strong></td>
                    <td style="padding: 8px 0; text-align: right;">${due_date}</td>
                  </tr>
                  ${days_overdue > 0 ? `<tr><td style="padding: 8px 0; color: #6b7280;"><strong>Days Overdue:</strong></td><td style="padding: 8px 0; text-align: right; color: #DC2626; font-weight: bold;">${days_overdue}</td></tr>` : ''}
                </table>
              </div>
              <p>Please reply to this email or contact us at ${owner_email || 'your business email'} if you have any questions.</p>
              <p>Thank you!</p>
            </div>
          </div>
        `,
      },
    ],
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
    throw new Error(`SendGrid invoice reminder error ${response.status}: ${errorBody}`);
  }

  console.log(`[Email] Invoice reminder sent to ${to}`);
  await logEmail({
    client_id,
    recipient_email: to,
    email_type: 'invoice-reminder',
    related_invoice_id: invoice_id,
    subject,
    delivery_status: 'sent',
  });
  return true;
}

/**
 * Send a seasonal reminder email (e.g., spring checkup, winter prep)
 */
async function sendSeasonalReminderEmail({ to, customer_name, service_description, client_id, business_name, booking_phone }) {
  business_name = business_name || 'the company';
  const subject = `${business_name}: Time for seasonal maintenance`;

  const emailContent = {
    personalizations: [
      {
        to: [{ email: to }],
        subject,
      },
    ],
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'noreply@example.com',
      name: business_name,
    },
    content: [
      {
        type: 'text/html',
        value: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #059669; color: white; padding: 20px; text-align: center;">
              <h2 style="margin: 0;">Time for Seasonal Maintenance</h2>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>Hi ${customer_name},</p>
              <p>It's that time of year! ${service_description}</p>
              <p>Scheduling preventive maintenance now helps avoid costly issues down the road and ensures your systems are running smoothly.</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="tel:${booking_phone}"
                   style="background: #059669; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Call to Schedule: ${booking_phone}
                </a>
              </p>
              <p style="color: #6b7280; font-size: 13px;">Or reply to this email to book your appointment today.</p>
              <p>Thank you for trusting ${business_name}!</p>
            </div>
          </div>
        `,
      },
    ],
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
    throw new Error(`SendGrid seasonal reminder error ${response.status}: ${errorBody}`);
  }

  console.log(`[Email] Seasonal reminder sent to ${to}`);
  await logEmail({
    client_id,
    recipient_email: to,
    email_type: 'seasonal',
    subject,
    delivery_status: 'sent',
  });
  return true;
}

module.exports = { sendConfirmationEmail, sendOwnerNotification, sendFollowUpEmail, sendOnboardingNotification, sendDemoNotification, sendCheckInEmail, sendInvoiceReminderEmail, sendSeasonalReminderEmail };
