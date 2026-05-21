import { google } from 'googleapis';
import { googleClient } from './google.js';
import { config } from './config.js';

// Turns a tab's raw rows into prospect objects. Finds the header row by
// locating a "Business Name" cell, so non-prospect tabs (e.g. a legend)
// yield nothing.
function rowsToProspects(values) {
  if (!values || !values.length) return [];
  const headerIdx = values.findIndex((r) =>
    r.some((c) => String(c).trim().toLowerCase() === 'business name')
  );
  if (headerIdx === -1) return [];
  const header = values[headerIdx].map((c) => String(c).trim().toLowerCase());
  const at = (name) => header.indexOf(name);
  const cols = {
    business: at('business name'),
    geo: at('geo'),
    decisionMaker: at('decision-maker'),
    tier: at('tier'),
    score: at('score (0-5)') !== -1 ? at('score (0-5)') : at('score'),
    email: at('email'),
  };
  const prospects = [];
  for (const row of values.slice(headerIdx + 1)) {
    const business = cols.business > -1 ? String(row[cols.business] || '').trim() : '';
    if (!business || business.toLowerCase() === 'business name') continue;
    const get = (i) => (i > -1 ? String(row[i] || '').trim() : '');
    prospects.push({
      business,
      geo: get(cols.geo),
      decisionMaker: get(cols.decisionMaker),
      tier: get(cols.tier),
      score: get(cols.score),
      email: get(cols.email),
    });
  }
  return prospects;
}

// Reads every tab of the configured spreadsheet and returns prospect rows.
// Returns [] if Google isn't configured or the read fails.
export async function readProspects() {
  const auth = googleClient();
  if (!auth || !config.google.sheetId) return [];
  try {
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: config.google.sheetId,
    });
    const tabs = (meta.data.sheets || []).map((s) => s.properties.title);
    const prospects = [];
    for (const tab of tabs) {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.sheetId,
        range: `'${tab}'`,
      });
      prospects.push(...rowsToProspects(res.data.values));
    }
    return prospects;
  } catch (err) {
    console.error('sheets.readProspects failed:', err.message);
    return [];
  }
}

export function prospectStats(prospects) {
  const byTier = {};
  const byGeo = {};
  for (const p of prospects) {
    const tier = (p.tier || '?').toUpperCase();
    byTier[tier] = (byTier[tier] || 0) + 1;
    const geo = p.geo || '?';
    byGeo[geo] = (byGeo[geo] || 0) + 1;
  }
  return { total: prospects.length, byTier, byGeo };
}
