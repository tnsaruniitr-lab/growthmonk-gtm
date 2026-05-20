import { config } from './config.js';

const RAW_BASE = 'https://raw.githubusercontent.com';

// Fetch a file from the public repo. Returns the text body, or null if missing.
export async function fetchFile(path) {
  const url = `${RAW_BASE}/${config.repo.slug}/${config.repo.branch}/${path}`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.text();
  } catch (err) {
    console.error(`repo.fetchFile(${path}) failed:`, err.message);
    return null;
  }
}

// ISO-8601 week id for a date, e.g. "2026-W21".
export function currentWeekId(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
