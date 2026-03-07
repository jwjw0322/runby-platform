// core/supabase.js
// Database connection using Supabase service role key (bypasses RLS)
// For server-side operations only — never expose this key to the client

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;
