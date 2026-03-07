require('dotenv').config();

async function run() {
  const id = process.env.VAPI_ASSISTANT_ID;
  const key = process.env.VAPI_API_KEY;

  if (!id || !key) {
    console.error('Missing VAPI_ASSISTANT_ID or VAPI_API_KEY');
    process.exit(1);
  }

  const res = await fetch(`https://api.vapi.ai/assistant/${id}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('VAPI_FETCH_ERROR', res.status, JSON.stringify(data));
    process.exit(1);
  }

  console.log('VAPI_ASSISTANT_ID:', data.id);
  console.log('VAPI_NAME:', data.name);
  console.log('VAPI_SERVER_URL:', data.serverUrl);
}

run().catch((e) => {
  console.error('CHECK_FAILED', e.message);
  process.exit(1);
});
