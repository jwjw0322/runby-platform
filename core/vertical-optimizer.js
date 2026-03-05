// core/vertical-optimizer.js
// AI-powered agent that analyzes recent calls and auto-improves vertical prompts & rules
// Runs daily per vertical via scheduled tasks

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Main optimization function — called by scheduled tasks
 * Analyzes last 24h of calls for a vertical and auto-improves prompt + rules
 */
async function optimizeVertical(verticalId) {
  console.log(`\n[Optimizer] Starting daily optimization for vertical: ${verticalId}`);
  console.log(`[Optimizer] Time: ${new Date().toISOString()}`);

  try {
    // 1. Gather recent call data for this vertical
    const callData = await gatherCallData(verticalId);

    if (callData.interactions.length === 0) {
      console.log(`[Optimizer] No calls in the last 24h for ${verticalId} — skipping`);
      return { verticalId, status: 'skipped', reason: 'no recent calls', changes: [] };
    }

    console.log(`[Optimizer] Found ${callData.interactions.length} calls to analyze`);

    // 2. Load current prompt and rules
    const currentPrompt = loadVerticalFile(verticalId, 'prompt.md');
    const currentRules = loadVerticalFile(verticalId, 'rules.json');

    if (!currentPrompt || !currentRules) {
      console.error(`[Optimizer] Missing prompt.md or rules.json for ${verticalId}`);
      return { verticalId, status: 'error', reason: 'missing vertical files', changes: [] };
    }

    // 3. Send to Claude for analysis
    const analysis = await analyzeWithClaude(verticalId, callData, currentPrompt, currentRules);

    if (!analysis) {
      console.log(`[Optimizer] No improvements suggested for ${verticalId}`);
      return { verticalId, status: 'no_changes', changes: [] };
    }

    // 4. Apply changes
    const changes = await applyChanges(verticalId, analysis, currentPrompt, currentRules);

    // 5. Save the daily report
    await saveReport(verticalId, callData, analysis, changes);

    console.log(`[Optimizer] Completed optimization for ${verticalId} — ${changes.length} changes applied`);
    return { verticalId, status: 'optimized', changes };

  } catch (error) {
    console.error(`[Optimizer] Error optimizing ${verticalId}:`, error.message);
    return { verticalId, status: 'error', reason: error.message, changes: [] };
  }
}

/**
 * Gather the last 24h of call data for clients in this vertical
 */
async function gatherCallData(verticalId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Get all clients in this vertical
  const { data: configs, error: configError } = await supabase
    .from('client_config')
    .select('client_id, business_name, services, service_area')
    .eq('vertical_id', verticalId);

  if (configError || !configs || configs.length === 0) {
    return { interactions: [], bookings: [], missedCalls: [], clients: [] };
  }

  const clientIds = configs.map(c => c.client_id);

  // Get recent interactions with transcripts
  const { data: interactions } = await supabase
    .from('interactions')
    .select(`
      id, client_id, caller_phone, duration_seconds, classification, outcome,
      summary, sentiment, action_items, created_at,
      transcripts ( full_text )
    `)
    .in('client_id', clientIds)
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  // Get recent bookings
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, client_id, service_type, status, created_at')
    .in('client_id', clientIds)
    .gte('created_at', since);

  // Get recent missed calls
  const { data: missedCalls } = await supabase
    .from('missed_calls')
    .select('id, client_id, reason, created_at')
    .in('client_id', clientIds)
    .gte('created_at', since);

  return {
    interactions: interactions || [],
    bookings: bookings || [],
    missedCalls: missedCalls || [],
    clients: configs,
  };
}

/**
 * Load a vertical's file (prompt.md or rules.json)
 */
function loadVerticalFile(verticalId, filename) {
  const filePath = path.join(__dirname, '..', 'verticals', verticalId, filename);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
}

/**
 * Send call data + current prompt to Claude for analysis and improvement suggestions
 */
async function analyzeWithClaude(verticalId, callData, currentPrompt, currentRules) {
  // Build a summary of the calls (limit transcript excerpts to keep token usage reasonable)
  const callSummaries = callData.interactions.slice(0, 20).map((interaction, i) => {
    const transcript = interaction.transcripts?.[0]?.full_text || '(no transcript)';
    // Limit each transcript to ~500 chars to avoid massive payloads
    const excerpts = transcript.length > 500 ? transcript.substring(0, 500) + '...' : transcript;
    return `--- Call ${i + 1} ---
Classification: ${interaction.classification || 'unknown'}
Outcome: ${interaction.outcome || 'unknown'}
Duration: ${interaction.duration_seconds || 0}s
Sentiment: ${interaction.sentiment || 'unknown'}
Summary: ${interaction.summary || '(none)'}
Action Items: ${interaction.action_items || '(none)'}
Transcript Excerpt: ${excerpts}`;
  }).join('\n\n');

  const bookingSummary = `Total bookings: ${callData.bookings.length}
Services booked: ${[...new Set(callData.bookings.map(b => b.service_type))].join(', ') || 'none'}
Statuses: ${[...new Set(callData.bookings.map(b => b.status))].join(', ') || 'none'}`;

  const missedSummary = `Total missed calls: ${callData.missedCalls.length}
Reasons: ${[...new Set(callData.missedCalls.map(m => m.reason))].join(', ') || 'none'}`;

  const systemPrompt = `You are an expert AI call center optimization analyst for the "${verticalId}" vertical in a home/business services company. You analyze recent call transcripts and suggest concrete improvements to the AI receptionist's prompt and rules.

Your analysis covers ALL of these areas:
1. MISSED BOOKINGS — Why callers didn't book. Objections, pricing, availability issues.
2. AWKWARD RESPONSES — Where the AI sounded robotic, repeated itself, or gave bad answers.
3. FAQ GAPS — Questions callers asked that the prompt doesn't address.
4. EMERGENCY HANDLING — Were emergencies detected and routed correctly?
5. UPSELL OPPORTUNITIES — Places where the AI could suggest related services.
6. TONE ISSUES — Was the AI too formal? Too casual? Did it match the caller's energy?

IMPORTANT RULES:
- Only suggest changes that are supported by evidence in the calls
- Keep the prompt's template variables intact: {{business_name}}, {{services}}, {{business_hours}}, {{service_area}}, {{current_date}}, {{current_time}}, {{current_day_of_week}}, {{tomorrow_date}}
- Do NOT change the fundamental structure — only refine sections, add FAQ entries, adjust tone guidance, or add handling for new scenarios
- For rules.json: you can add emergency keywords, adjust triage priorities, or modify business rules
- Be conservative — small targeted improvements, not rewrites`;

  const userMessage = `Here is the current prompt for the "${verticalId}" vertical:

<current_prompt>
${currentPrompt}
</current_prompt>

<current_rules>
${currentRules}
</current_rules>

Here are the calls from the last 24 hours:

<calls>
${callSummaries}
</calls>

<booking_stats>
${bookingSummary}
</booking_stats>

<missed_call_stats>
${missedSummary}
</missed_call_stats>

Analyze these calls and provide your response in this exact JSON format:
{
  "analysis_summary": "2-3 sentence overview of what you found",
  "issues_found": [
    { "area": "one of: missed_bookings, awkward_responses, faq_gaps, emergency_handling, upsell_opportunities, tone_issues", "description": "what you found", "evidence": "which call(s) showed this", "severity": "low/medium/high" }
  ],
  "prompt_changes": [
    { "section": "which section of the prompt to modify", "action": "add/modify/remove", "description": "what to change and why", "old_text": "exact text to find (if modifying/removing)", "new_text": "replacement text (if adding/modifying)" }
  ],
  "rules_changes": [
    { "field": "JSON path like emergency_keywords or business_rules.max_daily_bookings", "action": "add/modify/remove", "value": "the new value", "reason": "why" }
  ],
  "metrics": {
    "total_calls_analyzed": 0,
    "booking_conversion_rate": "X%",
    "avg_sentiment": "positive/neutral/negative",
    "top_services_requested": ["service1", "service2"]
  }
}

If there are NO meaningful improvements to make, return:
{ "analysis_summary": "No significant issues found", "issues_found": [], "prompt_changes": [], "rules_changes": [], "metrics": { ... } }

ONLY output valid JSON. No markdown, no explanation outside the JSON.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: userMessage }],
      system: systemPrompt,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorBody}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '';

  try {
    // Extract JSON from the response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (e) {
    console.error(`[Optimizer] Failed to parse Claude response:`, e.message);
    console.error(`[Optimizer] Raw response:`, text.substring(0, 500));
    return null;
  }
}

/**
 * Apply the suggested changes to prompt.md and rules.json
 */
async function applyChanges(verticalId, analysis, currentPrompt, currentRules) {
  const changes = [];

  // Apply prompt changes
  if (analysis.prompt_changes && analysis.prompt_changes.length > 0) {
    let updatedPrompt = currentPrompt;

    for (const change of analysis.prompt_changes) {
      if (change.action === 'modify' && change.old_text && change.new_text) {
        if (updatedPrompt.includes(change.old_text)) {
          updatedPrompt = updatedPrompt.replace(change.old_text, change.new_text);
          changes.push({ file: 'prompt.md', type: 'modified', detail: change.description });
          console.log(`[Optimizer] Applied prompt change: ${change.description}`);
        } else {
          console.log(`[Optimizer] Skipped prompt change (old_text not found): ${change.description}`);
        }
      } else if (change.action === 'add' && change.new_text) {
        // Add new text at the end of the specified section or before "## What you NEVER do"
        const insertPoint = updatedPrompt.indexOf('## What you NEVER do');
        if (insertPoint > -1) {
          updatedPrompt = updatedPrompt.slice(0, insertPoint) + change.new_text + '\n\n' + updatedPrompt.slice(insertPoint);
        } else {
          updatedPrompt += '\n\n' + change.new_text;
        }
        changes.push({ file: 'prompt.md', type: 'added', detail: change.description });
        console.log(`[Optimizer] Added to prompt: ${change.description}`);
      }
    }

    if (changes.some(c => c.file === 'prompt.md')) {
      // Verify template variables are still intact
      const requiredVars = ['{{business_name}}', '{{services}}', '{{business_hours}}', '{{service_area}}', '{{current_date}}', '{{current_time}}'];
      const missingVars = requiredVars.filter(v => !updatedPrompt.includes(v));

      if (missingVars.length > 0) {
        console.error(`[Optimizer] SAFETY CHECK FAILED — template variables removed: ${missingVars.join(', ')}`);
        console.error(`[Optimizer] Rolling back prompt changes for ${verticalId}`);
        changes = changes.filter(c => c.file !== 'prompt.md');
      } else {
        // Backup the original
        const backupDir = path.join(__dirname, '..', 'verticals', verticalId, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const timestamp = new Date().toISOString().split('T')[0];
        fs.writeFileSync(path.join(backupDir, `prompt_${timestamp}.md`), currentPrompt);

        // Write the updated prompt
        const promptPath = path.join(__dirname, '..', 'verticals', verticalId, 'prompt.md');
        fs.writeFileSync(promptPath, updatedPrompt);
        console.log(`[Optimizer] Saved updated prompt.md for ${verticalId}`);
      }
    }
  }

  // Apply rules changes
  if (analysis.rules_changes && analysis.rules_changes.length > 0) {
    try {
      let rulesObj = JSON.parse(currentRules);

      for (const change of analysis.rules_changes) {
        const pathParts = change.field.split('.');

        if (change.action === 'add') {
          setNestedValue(rulesObj, pathParts, change.value);
          changes.push({ file: 'rules.json', type: 'added', detail: change.reason });
          console.log(`[Optimizer] Added to rules: ${change.field} = ${JSON.stringify(change.value)}`);
        } else if (change.action === 'modify') {
          setNestedValue(rulesObj, pathParts, change.value);
          changes.push({ file: 'rules.json', type: 'modified', detail: change.reason });
          console.log(`[Optimizer] Modified in rules: ${change.field} = ${JSON.stringify(change.value)}`);
        }
      }

      if (changes.some(c => c.file === 'rules.json')) {
        // Backup original
        const backupDir = path.join(__dirname, '..', 'verticals', verticalId, 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const timestamp = new Date().toISOString().split('T')[0];
        fs.writeFileSync(path.join(backupDir, `rules_${timestamp}.json`), currentRules);

        // Write updated rules
        const rulesPath = path.join(__dirname, '..', 'verticals', verticalId, 'rules.json');
        fs.writeFileSync(rulesPath, JSON.stringify(rulesObj, null, 2) + '\n');
        console.log(`[Optimizer] Saved updated rules.json for ${verticalId}`);
      }
    } catch (e) {
      console.error(`[Optimizer] Failed to apply rules changes:`, e.message);
    }
  }

  return changes;
}

/**
 * Helper: set a value at a nested path in an object
 */
function setNestedValue(obj, pathParts, value) {
  let current = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    if (!current[pathParts[i]]) current[pathParts[i]] = {};
    current = current[pathParts[i]];
  }
  const lastKey = pathParts[pathParts.length - 1];

  // If current value is an array and new value is also, merge/append
  if (Array.isArray(current[lastKey]) && Array.isArray(value)) {
    const existing = new Set(current[lastKey]);
    for (const item of value) existing.add(item);
    current[lastKey] = [...existing];
  } else {
    current[lastKey] = value;
  }
}

/**
 * Save a daily report to the reports directory and to the database (alerts table)
 */
async function saveReport(verticalId, callData, analysis, changes) {
  // Save report to filesystem
  const reportsDir = path.join(__dirname, '..', 'verticals', verticalId, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().split('T')[0];
  const report = {
    date: timestamp,
    vertical: verticalId,
    calls_analyzed: callData.interactions.length,
    bookings: callData.bookings.length,
    missed_calls: callData.missedCalls.length,
    analysis: analysis.analysis_summary,
    issues: analysis.issues_found,
    changes_applied: changes,
    metrics: analysis.metrics,
  };

  fs.writeFileSync(
    path.join(reportsDir, `report_${timestamp}.json`),
    JSON.stringify(report, null, 2)
  );

  // Also send summary email to admin
  try {
    const { sendOptimizationReport } = require('./email-sender');
    // We'll use a lightweight approach — just log it for now
    console.log(`[Optimizer] Report saved: ${reportsDir}/report_${timestamp}.json`);
  } catch (e) {
    // email function not available yet, just log
  }

  // Create an alert for each client in this vertical so it shows in the dashboard
  for (const client of callData.clients) {
    const changeCount = changes.length;
    if (changeCount > 0) {
      await supabase.from('alerts').insert({
        client_id: client.client_id,
        type: 'system',
        severity: 'info',
        message: `[AI Optimizer] ${changeCount} improvement${changeCount > 1 ? 's' : ''} applied to your ${verticalId} receptionist: ${analysis.analysis_summary}`,
      });
    }
  }

  return report;
}

/**
 * Run optimization for all verticals (used if you want a single "optimize everything" call)
 */
async function optimizeAllVerticals() {
  const verticalsDir = path.join(__dirname, '..', 'verticals');
  const verticals = fs.readdirSync(verticalsDir).filter(d => {
    return fs.statSync(path.join(verticalsDir, d)).isDirectory() &&
           fs.existsSync(path.join(verticalsDir, d, 'prompt.md'));
  });

  console.log(`[Optimizer] Running optimization for ${verticals.length} verticals: ${verticals.join(', ')}`);
  const results = [];

  for (const vertical of verticals) {
    const result = await optimizeVertical(vertical);
    results.push(result);
    // Small delay between verticals to respect API rate limits
    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

// CLI support: node vertical-optimizer.js [vertical_id]
if (require.main === module) {
  const verticalId = process.argv[2];

  if (verticalId) {
    optimizeVertical(verticalId).then(result => {
      console.log('\n[Optimizer] Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    }).catch(err => {
      console.error(err);
      process.exit(1);
    });
  } else {
    optimizeAllVerticals().then(results => {
      console.log('\n[Optimizer] All results:', JSON.stringify(results, null, 2));
      process.exit(0);
    }).catch(err => {
      console.error(err);
      process.exit(1);
    });
  }
}

module.exports = { optimizeVertical, optimizeAllVerticals };
