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

// Marketing content-calendar counts (from the repo CSV).
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
