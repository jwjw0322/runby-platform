// test-connection.js
// Run this to test your Supabase connection: node test-connection.js

require('dotenv').config();

console.log('=== RunBy Connection Test ===\n');

// 1. Check .env values are loaded
console.log('1. Checking .env values...');
console.log('   SUPABASE_URL:', process.env.SUPABASE_URL || 'MISSING!');
console.log('   SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.slice(0, 20) + '...' : 'MISSING!');
console.log('   TEST_CLIENT_ID:', process.env.TEST_CLIENT_ID || 'MISSING!');
console.log('   VAPI_API_KEY:', process.env.VAPI_API_KEY ? process.env.VAPI_API_KEY.slice(0, 10) + '...' : 'MISSING!');
console.log('   SERVER_URL:', process.env.SERVER_URL || 'MISSING!');
console.log('');

// 2. Test Supabase connection
async function testSupabase() {
  console.log('2. Testing Supabase connection...');
  const { createClient } = require('@supabase/supabase-js');

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Try to read the clients table
  const { data, error } = await supabase
    .from('clients')
    .select('id, business_name')
    .limit(5);

  if (error) {
    console.log('   ERROR connecting to Supabase:', error.message);
    console.log('   Full error:', JSON.stringify(error, null, 2));
    return;
  }

  console.log('   SUCCESS! Connected to Supabase.');
  console.log('   Clients found:', data.length);
  data.forEach(c => console.log(`   - ${c.business_name} (${c.id})`));
  console.log('');

  // 3. Verify TEST_CLIENT_ID exists
  if (process.env.TEST_CLIENT_ID) {
    console.log('3. Verifying TEST_CLIENT_ID exists in database...');
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, business_name')
      .eq('id', process.env.TEST_CLIENT_ID)
      .single();

    if (clientError) {
      console.log('   ERROR: TEST_CLIENT_ID not found in clients table!');
      console.log('   This means calls will fail to log. The ID in your .env does not match any client.');
      console.log('   Error:', clientError.message);
    } else {
      console.log(`   SUCCESS! Found client: ${client.business_name}`);
    }
    console.log('');
  }

  // 4. Test writing to interactions table
  console.log('4. Testing write to interactions table...');
  const { data: testInsert, error: insertError } = await supabase
    .from('interactions')
    .insert({
      client_id: process.env.TEST_CLIENT_ID,
      vertical_id: 'hvac',
      type: 'call',
      direction: 'inbound',
      caller_number: '+10000000000',
      classification: 'test',
      outcome: 'resolved',
      duration_seconds: 0,
      source: 'direct',
      notes: 'Connection test — safe to delete',
    })
    .select()
    .single();

  if (insertError) {
    console.log('   ERROR writing to interactions:', insertError.message);
    console.log('   Full error:', JSON.stringify(insertError, null, 2));
  } else {
    console.log(`   SUCCESS! Test interaction created: ${testInsert.id}`);
    console.log('   Check your Supabase Table Editor — you should see this row in interactions.');

    // Clean up
    await supabase.from('interactions').delete().eq('id', testInsert.id);
    console.log('   (Cleaned up test row)');
  }

  console.log('\n=== Test Complete ===');
}

testSupabase().catch(err => {
  console.error('Test crashed:', err.message);
  console.error(err.stack);
});
