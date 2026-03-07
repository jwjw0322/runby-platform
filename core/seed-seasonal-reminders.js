// core/seed-seasonal-reminders.js
// Seeds default seasonal reminders for clients based on their vertical

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Map of vertical IDs to their seasonal reminders
 * Each reminder has: key (unique identifier), label (display name), month (1-12), description
 */
const VERTICAL_REMINDERS = {
  hvac: [
    {
      key: 'hvac-summer-tuneup',
      label: 'Summer AC Tune-Up',
      month: 5,
      description: 'Get your air conditioning system ready for the hot summer months. Our technicians will inspect, clean, and optimize your unit for peak efficiency.',
    },
    {
      key: 'hvac-winter-heating',
      label: 'Winter Heating Prep',
      month: 10,
      description: 'Prepare your heating system for winter. We\'ll service your furnace and ensure you stay warm and comfortable all season long.',
    },
  ],
  plumbing: [
    {
      key: 'plumbing-spring-checkup',
      label: 'Spring Plumbing Checkup',
      month: 4,
      description: 'Spring is the perfect time for a plumbing inspection. We\'ll check for leaks, test water pressure, and address any winter damage.',
    },
    {
      key: 'plumbing-winterize',
      label: 'Winterize Pipes',
      month: 11,
      description: 'Protect your pipes from freezing temperatures. Our winterization service prevents costly damage from frozen pipes.',
    },
  ],
  electrical: [
    {
      key: 'electrical-spring-safety',
      label: 'Spring Safety Inspection',
      month: 3,
      description: 'Schedule a comprehensive electrical safety inspection. We\'ll test circuits, check outlets, and ensure your home meets current safety standards.',
    },
    {
      key: 'electrical-storm-prep',
      label: 'Generator & Storm Prep',
      month: 9,
      description: 'Prepare for hurricane and storm season. We\'ll service your generator and install surge protection for your electrical systems.',
    },
  ],
  'general-contractor': [
    {
      key: 'gc-spring-exterior',
      label: 'Spring Exterior Inspection',
      month: 3,
      description: 'Spring is ideal for inspecting your home\'s exterior. We\'ll check the roof, siding, foundation, and landscaping for any winter damage.',
    },
    {
      key: 'gc-fall-weatherproofing',
      label: 'Fall Weatherproofing',
      month: 9,
      description: 'Prepare your home for winter weather. We\'ll seal cracks, weatherstrip doors, and ensure your home is protected from the elements.',
    },
  ],
  medspa: [
    {
      key: 'medspa-new-year',
      label: 'New Year Refresh Specials',
      month: 1,
      description: 'Start the new year refreshed! Take advantage of our New Year specials on popular treatments and rejuvenation services.',
    },
    {
      key: 'medspa-summer-glow',
      label: 'Summer Glow-Up',
      month: 6,
      description: 'Get ready for summer with our glow-up treatments. From skin rejuvenation to body treatments, we have everything you need.',
    },
    {
      key: 'medspa-fall-skin',
      label: 'Fall Skin Prep',
      month: 10,
      description: 'Transition your skin care for fall. Our specialists can help prep your skin as weather changes with targeted treatments.',
    },
  ],
};

/**
 * Seed seasonal reminders for a given client and vertical
 * Upserts into the seasonal_reminders table
 */
async function seedSeasonalReminders(client_id, vertical_id) {
  const reminders = VERTICAL_REMINDERS[vertical_id];

  if (!reminders) {
    console.error(`[Seed] Unknown vertical: ${vertical_id}`);
    return 0;
  }

  let seeded = 0;

  for (const reminder of reminders) {
    try {
      const { error } = await supabase.from('seasonal_reminders').upsert(
        {
          client_id,
          reminder_key: reminder.key,
          reminder_label: reminder.label,
          service_description: reminder.description,
          reminder_month: reminder.month,
          enabled: true,
          last_sent_at: null,
        },
        {
          onConflict: 'client_id,reminder_key',
        }
      );

      if (error) {
        console.error(`[Seed] Error upserting reminder ${reminder.key}:`, error.message);
      } else {
        console.log(`[Seed] Seeded reminder: ${reminder.label}`);
        seeded++;
      }
    } catch (err) {
      console.error(`[Seed] Exception for ${reminder.key}:`, err.message);
    }
  }

  console.log(`[Seed] Seeded ${seeded} seasonal reminders for client ${client_id}`);
  return seeded;
}

/**
 * CLI support: run with arguments: node seed-seasonal-reminders.js <client_id> <vertical_id>
 */
if (process.argv.length >= 4) {
  const client_id = process.argv[2];
  const vertical_id = process.argv[3];

  seedSeasonalReminders(client_id, vertical_id)
    .then(() => {
      console.log('[Seed] Done');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { seedSeasonalReminders, VERTICAL_REMINDERS };
