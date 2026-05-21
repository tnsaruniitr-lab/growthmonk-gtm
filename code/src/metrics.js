import { parse } from 'csv-parse/sync';
import { fetchFile } from './repo.js';

function parseCsv(text) {
  if (!text) return [];
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
}

const status = (row) => (row.status || '').toLowerCase();

// Sales pipeline counts. "Outreach done" = any lead at status >= contacted.
export async function salesMetrics() {
  const rows = parseCsv(await fetchFile('pipeline/sales_pipeline.csv'));
  const contactedOrBeyond = ['contacted', 'replied', 'call_booked', 'won'];
  const count = (s) => rows.filter((r) => status(r) === s).length;
  return {
    leads: rows.length,
    fresh: count('new'),
    contacted: rows.filter((r) => contactedOrBeyond.includes(status(r))).length,
    replied: count('replied'),
    callBooked: count('call_booked'),
    won: count('won'),
    lost: count('lost'),
  };
}

// Marketing content-calendar counts.
export async function marketingMetrics() {
  const rows = parseCsv(await fetchFile('content/content_calendar.csv'));
  const count = (s) => rows.filter((r) => status(r) === s).length;
  return {
    total: rows.length,
    ideas: count('idea'),
    draft: count('draft'),
    scheduled: count('scheduled'),
    published: count('published'),
  };
}
