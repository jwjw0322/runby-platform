// core/booking-handler.js
// Handles appointment booking and availability checking
// Now accepts clientId and clientConfig for multi-client support

const supabase = require('./supabase');
const { sendConfirmationEmail, sendOwnerNotification } = require('./email-sender');

/**
 * Book an appointment
 * @param {object} params - Booking details from Vapi function call
 * @param {string} clientId - Client UUID (from client-lookup or TEST_CLIENT_ID)
 * @param {object} clientConfig - Client config (business_name, owner_email, etc.)
 */
async function bookAppointment(params, clientId, clientConfig = {}) {
  const {
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    service_type,
    preferred_date,
    preferred_time,
    notes,
  } = params;

  // Fallback to env if no clientId passed
  clientId = clientId || process.env.TEST_CLIENT_ID;
  const businessName = clientConfig.business_name || 'the company';
  const verticalId = clientConfig.vertical_id || 'hvac';
  const ownerEmail = clientConfig.owner_email || process.env.OWNER_EMAIL;

  console.log(`\n[Booking] Creating appointment for ${businessName}...`);
  console.log(`  Customer: ${customer_name} (${customer_phone})`);
  console.log(`  Email: ${customer_email || 'not provided'}`);
  console.log(`  Address: ${customer_address || 'not provided'}`);
  console.log(`  Service: ${service_type}`);
  console.log(`  Date/Time: ${preferred_date} at ${preferred_time}`);

  // Check if the slot is available
  const available = await checkSlotAvailable(clientId, preferred_date, preferred_time);
  if (!available) {
    console.log('[Booking] Slot not available!');
    return {
      success: false,
      message: `Sorry, that time slot on ${preferred_date} at ${preferred_time} is already booked. Please offer the customer a different time.`,
    };
  }

  // Create the booking in Supabase
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      client_id: clientId,
      vertical_id: verticalId,
      customer_name,
      customer_phone,
      customer_email: customer_email || null,
      customer_address: customer_address || null,
      service_type,
      scheduled_date: preferred_date,
      scheduled_time: preferred_time,
      source: 'inbound',
      status: 'confirmed',
    })
    .select()
    .single();

  if (error) {
    console.error('[Booking] Database error:', JSON.stringify(error, null, 2));
    return {
      success: false,
      message: 'There was a problem creating the booking. Please apologize and ask the customer to call back.',
    };
  }

  console.log(`[Booking] SUCCESS — ID: ${booking.id}`);

  // Send confirmation email to customer
  if (customer_email) {
    try {
      await sendConfirmationEmail({
        to: customer_email,
        customer_name,
        service_type,
        date: preferred_date,
        time: preferred_time,
        address: customer_address,
        booking_id: booking.id,
        business_name: businessName,
      });
    } catch (emailErr) {
      console.error('[Booking] Customer email failed:', emailErr.message);
    }
  }

  // Send notification email to business owner
  if (ownerEmail) {
    try {
      await sendOwnerNotification({
        customer_name,
        customer_phone,
        customer_email,
        customer_address,
        service_type,
        date: preferred_date,
        time: preferred_time,
        booking_id: booking.id,
        notes,
        business_name: businessName,
        owner_email: ownerEmail,
      });
    } catch (ownerErr) {
      console.error('[Booking] Owner notification failed:', ownerErr.message);
    }
  }

  return {
    success: true,
    message: `Appointment confirmed for ${customer_name} on ${preferred_date} at ${preferred_time} for ${service_type}. Booking reference: ${booking.id.slice(0, 8).toUpperCase()}.`,
    booking_id: booking.id,
  };
}

/**
 * Check available time slots for a given date
 * @param {object} params - { date }
 * @param {string} clientId - Client UUID
 */
async function checkAvailability(params, clientId) {
  const { date } = params;
  clientId = clientId || process.env.TEST_CLIENT_ID;

  console.log(`\n[Availability] Checking slots for ${date}...`);

  const { data: existingBookings, error } = await supabase
    .from('bookings')
    .select('scheduled_time')
    .eq('client_id', clientId)
    .eq('scheduled_date', date)
    .neq('status', 'cancelled');

  if (error) {
    console.error('[Availability] Error:', error.message);
    return { available_slots: [], message: 'Unable to check availability right now.' };
  }

  const bookedTimes = existingBookings.map(b => b.scheduled_time);

  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  let allSlots = [];

  if (dayOfWeek === 0) {
    return { available_slots: [], message: 'We are closed on Sundays. The next available day is Monday.' };
  } else if (dayOfWeek === 6) {
    allSlots = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM'];
  } else {
    allSlots = ['8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM',
                '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'];
  }

  const availableSlots = allSlots.filter(slot => !bookedTimes.includes(slot));
  console.log(`[Availability] ${availableSlots.length} slots available on ${date}`);

  if (availableSlots.length === 0) {
    return { available_slots: [], message: `No available slots on ${date}. Please suggest the next business day.` };
  }

  return {
    available_slots: availableSlots,
    message: `Available times on ${date}: ${availableSlots.join(', ')}`,
  };
}

async function checkSlotAvailable(clientId, date, time) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id')
    .eq('client_id', clientId)
    .eq('scheduled_date', date)
    .eq('scheduled_time', time)
    .neq('status', 'cancelled');

  if (error) return true;
  return data.length === 0;
}

module.exports = { bookAppointment, checkAvailability };
