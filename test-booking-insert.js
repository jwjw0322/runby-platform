require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const payload = {
    client_id: process.env.TEST_CLIENT_ID,
    vertical_id: 'hvac',
    customer_name: 'Test Customer Supabase',
    customer_phone: '+15551234567',
    customer_email: 'test.customer@example.com',
    customer_address: '123 Test St, Test City',
    service_type: 'AC Tune-Up',
    scheduled_date: '2026-03-12',
    scheduled_time: '10:00 AM',
    source: 'inbound',
    status: 'confirmed',
  };

  const { data, error } = await supabase
    .from('bookings')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('INSERT_ERROR:', error.message);
    console.error(JSON.stringify(error, null, 2));
    process.exit(1);
  }

  console.log('INSERT_OK');
  console.log('BOOKING_ID:', data.id);
  console.log('CLIENT_ID:', data.client_id);
  console.log('CUSTOMER:', data.customer_name, data.customer_phone, data.customer_email);
  console.log('SCHEDULE:', data.scheduled_date, data.scheduled_time);
}

run().catch((err) => {
  console.error('TEST_CRASHED:', err.message);
  process.exit(1);
});
