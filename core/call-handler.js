// core/call-handler.js
// Post-call processing: logs interactions, saves transcripts, triggers alerts
// Now accepts clientData from server.js for multi-client routing

const supabase = require('./supabase');
const rules = require('../verticals/hvac/rules.json');

/**
 * Handle end-of-call report from Vapi
 * @param {object} event - Vapi webhook event
 * @param {object|null} clientData - { client, config } from client-lookup, or null for fallback
 * @param {string} agentType - 'client', 'onboarding', or 'sales'
 */
async function handleCallEnd(event, clientData = null, agentType = 'client') {
  console.log(`\n[handleCallEnd] Processing ${agentType} call end event...`);

  const report = event.message || event;

  // Extract transcript
  let transcript = '';
  if (typeof report.transcript === 'string') {
    transcript = report.transcript;
  } else if (Array.isArray(report.transcript)) {
    transcript = report.transcript
      .map(t => `${t.role}: ${t.content || t.text || ''}`)
      .join('\n');
  } else if (report.artifact?.transcript) {
    if (typeof report.artifact.transcript === 'string') {
      transcript = report.artifact.transcript;
    } else if (Array.isArray(report.artifact.transcript)) {
      transcript = report.artifact.transcript
        .map(t => `${t.role}: ${t.content || t.text || ''}`)
        .join('\n');
    }
  }

  const duration = report.durationSeconds || report.duration || report.artifact?.duration || report.call?.duration || 0;
  const callerNumber = report.customer?.number || report.call?.customer?.number || 'unknown';
  const callerName = report.customer?.name || report.call?.customer?.name || null;
  const summary = report.summary || report.artifact?.summary || report.analysis?.summary || null;

  // Get client_id — from dynamic lookup or fallback to TEST_CLIENT_ID
  const clientId = clientData?.client?.id || process.env.TEST_CLIENT_ID;
  const verticalId = clientData?.client?.vertical_id || (agentType === 'client' ? 'hvac' : 'internal');
  const businessName = clientData?.config?.business_name || 'Unknown';

  if (!clientId) {
    const err = new Error('[Call End] No client ID found — cannot write to database!');
    console.error(err.message);
    throw err;
  }

  console.log(`[Call End] Agent: ${agentType} | Client: ${businessName} (${clientId})`);
  console.log(`[Call End] Caller: ${callerNumber}, Duration: ${duration}s`);

  // Classify based on agent type
  let classification;
  let outcome;
  if (agentType === 'onboarding') {
    classification = 'onboarding';
    outcome = transcript.toLowerCase().includes('saved') || transcript.toLowerCase().includes('information') ? 'resolved' : 'incomplete';
  } else if (agentType === 'sales') {
    classification = 'sales';
    outcome = transcript.toLowerCase().includes('demo') || transcript.toLowerCase().includes('book') ? 'booked' : 'resolved';
  } else {
    classification = classifyCall(transcript);
    outcome = detectEmergency(transcript) ? 'transferred' : 'resolved';
  }

  const isEmergency = agentType === 'client' && detectEmergency(transcript);

  // 1. Log the interaction
  const { data: interaction, error: interactionError } = await supabase
    .from('interactions')
    .insert({
      client_id: clientId,
      vertical_id: verticalId,
      type: 'call',
      direction: 'inbound',
      caller_number: callerNumber,
      caller_name: callerName,
      classification,
      outcome,
      duration_seconds: Math.round(duration),
      source: agentType,  // 'client', 'onboarding', or 'sales'
    })
    .select()
    .single();

  if (interactionError) {
    const err = new Error(`[DB Error] Interaction insert failed: ${JSON.stringify(interactionError)}`);
    console.error(err.message);
    throw err;
  }

  console.log(`[DB] Interaction logged: ${interaction.id}`);

  // 2. Save the transcript
  if (transcript.length > 0) {
    const { error: transcriptError } = await supabase
      .from('transcripts')
      .insert({
        interaction_id: interaction.id,
        client_id: clientId,
        full_text: transcript,
        summary,
        sentiment: 'neutral',
      });

    if (transcriptError) {
      console.error('[DB Error] Transcript:', transcriptError.message);
    } else {
      console.log('[DB] Transcript saved');
    }
  }

  // 3. If emergency, create an alert
  if (isEmergency) {
    const { error: alertError } = await supabase
      .from('alerts')
      .insert({
        client_id: clientId,
        type: 'emergency',
        severity: 'critical',
        message: `Emergency call from ${callerNumber}: ${classification}`,
        interaction_id: interaction.id,
      });

    if (!alertError) {
      console.log(`[ALERT] Emergency alert created for ${callerNumber}`);
    }
  }

  console.log('[handleCallEnd] Done.\n');
}

/**
 * Handle real-time transcript updates
 */
async function handleTranscript(event) {
  const text = event.transcript?.text || event.message?.transcript?.text || '';
  console.log('[Transcript]', typeof text === 'string' ? text.slice(0, 100) : '');
}

function classifyCall(transcript) {
  const lower = transcript.toLowerCase();
  if (detectEmergency(transcript)) return 'emergency';
  if (lower.includes('appointment') || lower.includes('schedule') || lower.includes('book') || lower.includes('cita')) return 'booking';
  if (lower.includes('estimate') || lower.includes('quote') || lower.includes('price') || lower.includes('precio')) return 'estimate';
  if (lower.includes('maintenance') || lower.includes('tune-up') || lower.includes('mantenimiento')) return 'maintenance';
  return 'inquiry';
}

function detectEmergency(transcript) {
  const lower = transcript.toLowerCase();
  return rules.emergency_keywords.some(keyword => lower.includes(keyword));
}

module.exports = { handleCallEnd, handleTranscript };
