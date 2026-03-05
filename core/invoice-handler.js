// core/invoice-handler.js
// Manages invoice syncing and status updates

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

/**
 * Sync invoices from external sources (QuickBooks, FreshBooks, etc.)
 * Upserts into the invoices table using (client_id, external_invoice_id) as conflict key
 */
async function syncInvoices(client_id, invoices) {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return { synced: 0, errors: [] };
  }

  const errors = [];
  let synced = 0;

  for (const invoice of invoices) {
    try {
      const {
        external_invoice_id,
        customer_name,
        customer_email,
        customer_phone,
        amount,
        due_date,
        status,
        invoice_date,
        paid_date,
        notes,
      } = invoice;

      const { error } = await supabase.from('invoices').upsert(
        {
          client_id,
          external_invoice_id,
          customer_name,
          customer_email,
          customer_phone,
          amount: parseFloat(amount) || 0,
          due_date,
          status: status || 'pending',
          invoice_date,
          paid_date: paid_date || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'client_id,external_invoice_id',
        }
      );

      if (error) {
        errors.push({ invoice_id: external_invoice_id, error: error.message });
      } else {
        synced++;
      }
    } catch (err) {
      errors.push({ invoice: JSON.stringify(invoice), error: err.message });
    }
  }

  return { synced, errors };
}

/**
 * Mark all pending invoices that are past due as 'overdue'
 * Returns count of updated invoices
 */
async function markOverdueInvoices() {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const { data, error } = await supabase
      .from('invoices')
      .update({
        status: 'overdue',
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'pending')
      .lt('due_date', today)
      .select();

    if (error) {
      console.error('[Invoice] Failed to mark overdue invoices:', error.message);
      return { updated: 0 };
    }

    return { updated: data ? data.length : 0 };
  } catch (err) {
    console.error('[Invoice] Error marking overdue:', err.message);
    return { updated: 0 };
  }
}

module.exports = { syncInvoices, markOverdueInvoices };
