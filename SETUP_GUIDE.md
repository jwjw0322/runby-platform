# RunBy Platform — Step-by-Step Setup Guide

---

## STEP 1: Install Node.js Dependencies

Open a terminal (Command Prompt, PowerShell, or VS Code terminal) and navigate to your project:

```
cd C:\Users\Jon\Desktop\runby
```

Then install all packages:

```
npm install
```

You should see a `node_modules` folder appear. If you get errors, make sure Node.js is installed by running `node --version` (you need v18 or higher).

---

## STEP 2: Set Up Supabase (Your Database)

### 2a. Create a Supabase account
1. Go to https://supabase.com
2. Click "Start your project" and sign up (GitHub login works)
3. Click "New Project"
4. Name it `runby-platform`
5. Set a database password (save this somewhere safe)
6. Choose a region close to you (e.g., East US)
7. Click "Create new project" — wait ~2 minutes for it to provision

### 2b. Get your API keys
1. In your Supabase project, click the **gear icon** (Settings) in the left sidebar
2. Click **API** under "Project Settings"
3. You'll see three things you need:
   - **Project URL** → looks like `https://abcdefgh.supabase.co`
   - **anon public key** → starts with `eyJ...`
   - **service_role secret key** → also starts with `eyJ...` (click "Reveal" to see it)
4. Open `C:\Users\Jon\Desktop\runby\.env` in a text editor and fill in:
   ```
   SUPABASE_URL=https://abcdefgh.supabase.co
   SUPABASE_ANON_KEY=eyJ...(your anon key)
   SUPABASE_SERVICE_KEY=eyJ...(your service role key)
   ```

### 2c. Create the database tables
1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New Query**
3. Open the file `C:\Users\Jon\Desktop\runby\sql\001_create_tables.sql`
4. Select ALL the text (Ctrl+A), copy it (Ctrl+C)
5. Paste it into the Supabase SQL Editor (Ctrl+V)
6. Click the green **Run** button (or press Ctrl+Enter)
7. You should see "Success. No rows returned" — this is correct
8. To verify: click **Table Editor** in the left sidebar — you should see all 10 tables listed (clients, client_config, interactions, transcripts, bookings, missed_calls, estimates, reviews, alerts, client_users)

### 2d. Enable Realtime (for live dashboard later)
1. In your Supabase project, click **Database** in the left sidebar
2. Click **Replication**
3. Find the tables: `interactions`, `alerts`, `bookings`
4. Toggle realtime ON for each of those three tables
   (Note: the SQL file already tried to do this — if you see they're already enabled, you're good)

---

## STEP 3: Set Up Twilio (Phone Numbers)

### 3a. Create a Twilio account
1. Go to https://www.twilio.com/try-twilio
2. Sign up with your email
3. Verify your phone number (they'll send you a code)
4. On the welcome screen, select "Voice" as what you want to use

### 3b. Get a phone number
1. In the Twilio Console, go to **Phone Numbers** → **Manage** → **Buy a number**
2. Search for a number in your area code
3. Make sure it has "Voice" capability checked
4. Click **Buy** (trial accounts get one free number)
5. Your number will look like `+13055551234`

### 3c. Get your API credentials
1. Go to your Twilio Console dashboard (https://console.twilio.com)
2. You'll see right on the main page:
   - **Account SID** → starts with `AC...`
   - **Auth Token** → click the eye icon to reveal it
3. Update your `.env` file:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_PHONE_NUMBER=+13055551234
   ```

---

## STEP 4: Set Up Vapi (Voice AI Engine)

### 4a. Create a Vapi account
1. Go to https://vapi.ai
2. Click "Get Started" and sign up
3. Once logged in, go to your Dashboard

### 4b. Get your API key
1. In the Vapi dashboard, click your profile icon or go to **Settings**
2. Find **API Keys** section
3. Copy your API key
4. Update your `.env` file:
   ```
   VAPI_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

### 4c. Connect Vapi to your Twilio number
1. In the Vapi dashboard, go to **Phone Numbers**
2. Click **Import** or **Add Phone Number**
3. Enter your Twilio credentials (Account SID and Auth Token)
4. Select the phone number you bought in Step 3
5. Vapi will configure the number to route calls through its AI engine

---

## STEP 5: Set Up Anthropic (Claude AI — the brain)

1. Go to https://console.anthropic.com
2. Sign up or log in
3. Go to **API Keys** in the left sidebar
4. Click **Create Key**, name it `runby-platform`
5. Copy the key (starts with `sk-ant-...`)
6. Update your `.env` file:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
7. Note: You need credits on your account. Add a payment method under **Billing**.

---

## STEP 6: Set Up ElevenLabs (Voice — how Alex sounds)

### 6a. Create account
1. Go to https://elevenlabs.io
2. Sign up (free tier gives you some characters per month)

### 6b. Choose a voice
1. Go to **Voice Library** in the left sidebar
2. Browse voices — pick one that sounds like a professional receptionist
3. Click on the voice, then click **Use Voice** or **Add to My Voices**
4. Go to **My Voices** → click on the voice you chose
5. The URL will contain the voice ID, or you'll see it in the voice settings
   (looks like `21m00Tcm4TlvDq8ikWAM`)

### 6c. Get your API key
1. Click your profile icon → **Profile + API key**
2. Copy the API key
3. Update your `.env` file:
   ```
   ELEVENLABS_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
   ```

---

## STEP 7: Set Up ngrok (Tunnels webhooks to your local machine)

### 7a. Install ngrok
1. Go to https://ngrok.com/download
2. Download for Windows
3. Unzip it — you'll get `ngrok.exe`
4. Move it somewhere permanent (like `C:\tools\ngrok.exe`)
5. Add that folder to your system PATH, or just navigate to it when running

### 7b. Create an ngrok account (required now)
1. Go to https://dashboard.ngrok.com/signup
2. Sign up (free)
3. Go to **Your Authtoken** in the dashboard
4. Copy the authtoken
5. Run this in your terminal:
   ```
   ngrok config add-authtoken YOUR_AUTH_TOKEN_HERE
   ```

### 7c. Start the tunnel
1. Open a NEW terminal window (keep this one running separately)
2. Run:
   ```
   ngrok http 3000
   ```
3. You'll see output like:
   ```
   Forwarding  https://a1b2c3d4.ngrok-free.app -> http://localhost:3000
   ```
4. Copy that `https://....ngrok-free.app` URL
5. Update your `.env` file:
   ```
   SERVER_URL=https://a1b2c3d4.ngrok-free.app
   ```
   **Important:** This URL changes every time you restart ngrok (on the free plan). You'll need to update it each time.

---

## STEP 8: Create a Test Client in Your Database

1. Go to Supabase → **SQL Editor** → **New Query**
2. Paste and run this:

```sql
-- Insert a test HVAC client
INSERT INTO clients (name, business_name, vertical_id, phone, email, twilio_number, status)
VALUES (
  'Test Owner',
  'ABC Heating & Cooling',
  'hvac',
  '+13055559999',
  'test@abcheating.com',
  '+13055551234',
  'pilot'
)
RETURNING id;
```

3. The query will return a UUID like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
4. Copy that UUID
5. Now run this (replace the UUID with yours):

```sql
-- Insert the config for this client
INSERT INTO client_config (client_id, vertical_id, business_name, services, service_area, business_hours)
VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'hvac',
  'ABC Heating & Cooling',
  '["AC repair", "heating repair", "maintenance", "duct cleaning", "new installs"]',
  'Miami-Dade County',
  '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":{"open":"09:00","close":"14:00"}}'
);
```

6. Update your `.env` file with the client UUID:
   ```
   TEST_CLIENT_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890
   ```

---

## STEP 9: Create the Vapi Assistant

1. Go back to your FIRST terminal (in the runby folder)
2. Run:
   ```
   node core/vapi-config.js
   ```
3. You should see output like:
   ```
   Assistant created: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   Save this ID in your .env as VAPI_ASSISTANT_ID
   ```
4. Copy that ID and update your `.env`:
   ```
   VAPI_ASSISTANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```

If you get an error:
- "Unauthorized" → check your VAPI_API_KEY in .env
- "fetch is not defined" → update Node.js to v18+
- Connection error → check your internet connection

---

## STEP 10: Start the Server and Make a Test Call

### 10a. Start the server
1. Make sure ngrok is still running in its own terminal window
2. In your project terminal, run:
   ```
   npm start
   ```
3. You should see:
   ```
   RunBy server listening on port 3000
   Webhook URL: http://localhost:3000/webhook/vapi
   ```

### 10b. Connect the webhook to Vapi
1. Go to the Vapi dashboard → **Assistants**
2. Click on "RunBy HVAC - ABC Heating"
3. Find the **Server URL** setting
4. Make sure it's set to: `https://YOUR-NGROK-URL.ngrok-free.app/webhook/vapi`
   (This should have been set automatically when you created the assistant, but double check)

### 10c. Make your first test call
1. Call your Twilio phone number from your cell phone
2. You should hear Alex answer: "Thanks for calling ABC Heating and Cooling, this is Alex. How can I help you today?"
3. Try saying: "Hi, I need to get my AC fixed. It's blowing warm air."
4. Alex should ask for your name, phone number, and try to book an appointment

### 10d. Check that data was logged
1. After the call ends, go to Supabase → **Table Editor**
2. Click on the `interactions` table — you should see your call logged
3. Click on `transcripts` — you should see the full conversation

---

## YOUR .env FILE SHOULD NOW LOOK LIKE THIS

```
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=+1your_twilio_number_here

# Vapi
VAPI_API_KEY=your_vapi_api_key_here
VAPI_ASSISTANT_ID=your_vapi_assistant_id_here

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# ElevenLabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_elevenlabs_voice_id_here

# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_KEY=your_supabase_service_key_here

# SendGrid (not needed yet — used later for email features)
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxx

# Server
PORT=3000
SERVER_URL=https://a1b2c3d4.ngrok-free.app

# Test
TEST_CLIENT_ID=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## TROUBLESHOOTING

**"Cannot find module" error when running npm start**
→ Run `npm install` again from the runby folder

**ngrok says "tunnel not found"**
→ Restart ngrok: `ngrok http 3000` and update SERVER_URL in .env

**Vapi returns 401 Unauthorized**
→ Double-check your VAPI_API_KEY in .env — no extra spaces

**No data appears in Supabase after a call**
→ Check that TEST_CLIENT_ID in .env matches the UUID from Step 8
→ Look at your terminal for error messages

**Alex doesn't answer the phone**
→ Make sure Vapi is connected to your Twilio number (Step 4c)
→ Make sure the assistant has the correct server URL (Step 10b)

**Call connects but Alex sounds robotic/wrong**
→ Check your ElevenLabs voice ID is correct
→ Try a different voice from the ElevenLabs library
