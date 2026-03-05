// core/vertical-creator.js
// AI agent that researches and creates new service verticals for RunBy
// Runs weekly — analyzes market trends, existing verticals, and creates new ones

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Industries that are strong fits for AI receptionists
const EXPANSION_CATEGORIES = [
  'home services',
  'healthcare & wellness',
  'automotive',
  'professional services',
  'hospitality & food',
  'fitness & recreation',
  'pet services',
  'beauty & personal care',
  'property management',
  'cleaning services',
];

/**
 * Main function — discovers and creates a new vertical
 */
async function createNewVertical() {
  console.log(`\n[Vertical Creator] Starting weekly vertical discovery`);
  console.log(`[Vertical Creator] Time: ${new Date().toISOString()}`);

  try {
    // 1. Check what verticals already exist
    const existingVerticals = getExistingVerticals();
    console.log(`[Vertical Creator] Existing verticals: ${existingVerticals.join(', ')}`);

    // 2. Load a sample prompt and rules to use as reference
    const referencePrompt = loadFile('hvac', 'prompt.md');
    const referenceRules = loadFile('hvac', 'rules.json');

    if (!referencePrompt || !referenceRules) {
      throw new Error('Cannot load reference vertical files (hvac)');
    }

    // 3. Ask Claude to pick the best next vertical and generate files
    const newVertical = await designVerticalWithClaude(existingVerticals, referencePrompt, referenceRules);

    if (!newVertical) {
      console.log(`[Vertical Creator] No new vertical generated this week`);
      return { status: 'skipped', reason: 'Claude did not suggest a new vertical' };
    }

    // 4. Validate the output
    const validation = validateVertical(newVertical);
    if (!validation.valid) {
      console.error(`[Vertical Creator] Validation failed: ${validation.errors.join(', ')}`);
      return { status: 'error', reason: `Validation failed: ${validation.errors.join(', ')}` };
    }

    // 5. Create the vertical directory and files
    const verticalDir = path.join(__dirname, '..', 'verticals', newVertical.vertical_id);
    if (fs.existsSync(verticalDir)) {
      console.log(`[Vertical Creator] Vertical "${newVertical.vertical_id}" already exists — skipping`);
      return { status: 'skipped', reason: 'already exists' };
    }

    fs.mkdirSync(verticalDir, { recursive: true });
    fs.writeFileSync(path.join(verticalDir, 'prompt.md'), newVertical.prompt);
    fs.writeFileSync(path.join(verticalDir, 'rules.json'), JSON.stringify(newVertical.rules, null, 2) + '\n');

    console.log(`[Vertical Creator] Created new vertical: ${newVertical.vertical_id}`);
    console.log(`[Vertical Creator] Directory: ${verticalDir}`);

    // 6. Add seasonal reminders for the new vertical
    const { seedSeasonalReminders } = require('./seed-seasonal-reminders');
    // We won't have a client_id yet but the VERTICAL_REMINDERS might not have this new vertical
    // Save the seasonal reminder definitions for future use
    const remindersFile = path.join(verticalDir, 'seasonal-defaults.json');
    fs.writeFileSync(remindersFile, JSON.stringify(newVertical.seasonal_reminders || [], null, 2) + '\n');

    // 7. Save a creation report
    const reportsDir = path.join(verticalDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const timestamp = new Date().toISOString().split('T')[0];
    const report = {
      date: timestamp,
      vertical_id: newVertical.vertical_id,
      display_name: newVertical.display_name,
      category: newVertical.category,
      rationale: newVertical.rationale,
      target_businesses: newVertical.target_businesses,
      seasonal_reminders: newVertical.seasonal_reminders,
    };
    fs.writeFileSync(
      path.join(reportsDir, `creation_report_${timestamp}.json`),
      JSON.stringify(report, null, 2)
    );

    // 8. Update the seed-seasonal-reminders.js to include the new vertical
    await updateSeasonalSeedFile(newVertical);

    console.log(`[Vertical Creator] Finished creating "${newVertical.vertical_id}" vertical`);

    return {
      status: 'created',
      vertical_id: newVertical.vertical_id,
      display_name: newVertical.display_name,
      category: newVertical.category,
    };

  } catch (error) {
    console.error(`[Vertical Creator] Error:`, error.message);
    return { status: 'error', reason: error.message };
  }
}

/**
 * Get list of existing vertical directories
 */
function getExistingVerticals() {
  const verticalsDir = path.join(__dirname, '..', 'verticals');
  if (!fs.existsSync(verticalsDir)) return [];

  return fs.readdirSync(verticalsDir).filter(d => {
    const dirPath = path.join(verticalsDir, d);
    return fs.statSync(dirPath).isDirectory() &&
           fs.existsSync(path.join(dirPath, 'prompt.md'));
  });
}

/**
 * Load a file from an existing vertical
 */
function loadFile(verticalId, filename) {
  const filePath = path.join(__dirname, '..', 'verticals', verticalId, filename);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Ask Claude to design a new vertical
 */
async function designVerticalWithClaude(existingVerticals, referencePrompt, referenceRules) {
  const systemPrompt = `You are an expert at building AI receptionist systems for service businesses. You design new industry verticals for an AI phone receptionist platform called RunBy.

Each vertical needs:
1. A prompt.md — the AI receptionist's personality, knowledge, and call-handling instructions
2. A rules.json — emergency keywords, triage priorities, and business rules
3. Seasonal reminders — proactive outreach timing for that industry

You must follow the EXACT same structure as the reference prompt, including ALL template variables:
- {{business_name}}, {{services}}, {{business_hours}}, {{service_area}}
- {{current_date}}, {{current_time}}, {{current_day_of_week}}, {{tomorrow_date}}

The prompt should include:
- AI personality section (professional, warm, industry-appropriate tone)
- Full bilingual English/Spanish support with industry-specific Spanish terms
- Date & time awareness section (identical to reference)
- "What you know" section with industry context
- Detailed call handling flows for that industry (new customers, emergencies, estimates, pricing)
- "What you NEVER do" section with industry-specific guardrails

The rules.json should include:
- emergency_keywords specific to that industry
- triage_priority with emergency/urgent/standard/low categories
- business_rules with sensible defaults (booking buffers, daily limits, appointment durations)

Be creative but practical — pick verticals that have high call volumes and would genuinely benefit from AI reception.`;

  const userMessage = `Here are the verticals that already exist: ${existingVerticals.join(', ')}

Here are categories to consider: ${EXPANSION_CATEGORIES.join(', ')}

Here is the reference prompt (HVAC) to follow the exact same structure:

<reference_prompt>
${referencePrompt}
</reference_prompt>

<reference_rules>
${referenceRules}
</reference_rules>

Pick ONE new vertical that doesn't exist yet. Choose something with high demand and strong fit for AI reception.

Respond in this exact JSON format:
{
  "vertical_id": "kebab-case-id (e.g., pet-grooming, auto-repair)",
  "display_name": "Human Readable Name",
  "category": "which category from the list above",
  "rationale": "2-3 sentences on why this vertical is a good fit",
  "target_businesses": "description of ideal customers",
  "prompt": "THE FULL prompt.md CONTENT — must include all template variables and follow the exact same section structure as the reference",
  "rules": {
    "emergency_keywords": ["keyword1", "keyword2"],
    "emergency_action": "alert_owner_immediately",
    "triage_priority": {
      "emergency": ["situation1"],
      "urgent": ["situation2"],
      "standard": ["situation3"],
      "low": ["situation4"]
    },
    "business_rules": {
      "after_hours_emergencies": true,
      "booking_buffer_minutes": 30,
      "max_daily_bookings": 12,
      "default_appointment_duration_minutes": 60
    }
  },
  "seasonal_reminders": [
    { "key": "vertical-season-service", "label": "Human Label", "month": 3 }
  ]
}

ONLY output valid JSON. No markdown wrapping, no explanation outside the JSON.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8192,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      temperature: 0.7, // Slightly higher for creativity
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (e) {
    console.error(`[Vertical Creator] Failed to parse response:`, e.message);
    console.error(`[Vertical Creator] Raw:`, text.substring(0, 500));
    return null;
  }
}

/**
 * Validate that a generated vertical has all required pieces
 */
function validateVertical(vertical) {
  const errors = [];

  if (!vertical.vertical_id || typeof vertical.vertical_id !== 'string') {
    errors.push('missing or invalid vertical_id');
  }
  if (!/^[a-z0-9-]+$/.test(vertical.vertical_id || '')) {
    errors.push('vertical_id must be kebab-case');
  }
  if (!vertical.prompt || typeof vertical.prompt !== 'string') {
    errors.push('missing prompt');
  }
  if (!vertical.rules || typeof vertical.rules !== 'object') {
    errors.push('missing rules');
  }

  // Verify template variables in the prompt
  const requiredVars = [
    '{{business_name}}', '{{services}}', '{{business_hours}}',
    '{{service_area}}', '{{current_date}}', '{{current_time}}',
  ];
  if (vertical.prompt) {
    for (const v of requiredVars) {
      if (!vertical.prompt.includes(v)) {
        errors.push(`prompt missing template variable: ${v}`);
      }
    }
  }

  // Verify rules structure
  if (vertical.rules) {
    if (!Array.isArray(vertical.rules.emergency_keywords)) {
      errors.push('rules missing emergency_keywords array');
    }
    if (!vertical.rules.triage_priority) {
      errors.push('rules missing triage_priority');
    }
    if (!vertical.rules.business_rules) {
      errors.push('rules missing business_rules');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Append the new vertical's seasonal reminders to seed-seasonal-reminders.js
 * This updates the VERTICAL_REMINDERS constant so future clients get the defaults
 */
async function updateSeasonalSeedFile(newVertical) {
  if (!newVertical.seasonal_reminders || newVertical.seasonal_reminders.length === 0) return;

  const seedFilePath = path.join(__dirname, 'seed-seasonal-reminders.js');
  try {
    let content = fs.readFileSync(seedFilePath, 'utf8');

    // Check if this vertical already exists in the file
    if (content.includes(`'${newVertical.vertical_id}':`)) {
      console.log(`[Vertical Creator] Seasonal reminders for ${newVertical.vertical_id} already in seed file`);
      return;
    }

    // Build the new entry
    const remindersStr = newVertical.seasonal_reminders.map(r =>
      `    { key: '${r.key}', label: '${r.label}', month: ${r.month} }`
    ).join(',\n');

    const newEntry = `\n  '${newVertical.vertical_id}': [\n${remindersStr},\n  ],`;

    // Insert before the closing of VERTICAL_REMINDERS object
    // Find the last "]," followed by "};" pattern
    const insertIndex = content.lastIndexOf('};');
    if (insertIndex > -1) {
      // Find the position right before the closing };
      content = content.slice(0, insertIndex) + newEntry + '\n' + content.slice(insertIndex);
      fs.writeFileSync(seedFilePath, content);
      console.log(`[Vertical Creator] Added ${newVertical.vertical_id} to seed-seasonal-reminders.js`);
    }
  } catch (e) {
    console.error(`[Vertical Creator] Failed to update seed file:`, e.message);
  }
}

/**
 * List all verticals with their status
 */
function listVerticals() {
  const verticals = getExistingVerticals();
  console.log(`\n[Vertical Creator] ${verticals.length} verticals found:\n`);
  for (const v of verticals) {
    const hasPrompt = fs.existsSync(path.join(__dirname, '..', 'verticals', v, 'prompt.md'));
    const hasRules = fs.existsSync(path.join(__dirname, '..', 'verticals', v, 'rules.json'));
    const hasReports = fs.existsSync(path.join(__dirname, '..', 'verticals', v, 'reports'));
    console.log(`  - ${v} [prompt: ${hasPrompt ? 'yes' : 'NO'}, rules: ${hasRules ? 'yes' : 'NO'}, reports: ${hasReports ? 'yes' : 'no'}]`);
  }
  return verticals;
}

// CLI support
if (require.main === module) {
  const command = process.argv[2];

  if (command === 'list') {
    listVerticals();
  } else if (command === 'create') {
    createNewVertical().then(result => {
      console.log('\n[Vertical Creator] Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    }).catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.log('Usage:');
    console.log('  node vertical-creator.js list      — Show all existing verticals');
    console.log('  node vertical-creator.js create    — Generate a new vertical');
    process.exit(0);
  }
}

module.exports = { createNewVertical, listVerticals, getExistingVerticals };
