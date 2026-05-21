import { google } from 'googleapis';
import { googleClient } from './google.js';
import { readProspects } from './sheets.js';

function extractEmail(header) {
  const m = header.match(/<([^>]+)>/);
  return (m ? m[1] : header).trim().toLowerCase();
}

// Display name from an address header ("Name <email>"), or the email itself.
function displayName(header) {
  const m = header.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : header).trim();
}

// Messages in `box` ('inbox' | 'sent') from the last `hours` hours.
// `party` is the address header to read: 'From' for inbox, 'To' for sent.
async function recentMessages(box, party, hours) {
  const auth = googleClient();
  if (!auth) return [];
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const after = Math.floor(Date.now() / 1000) - hours * 3600;
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `in:${box} after:${after}`,
      maxResults: 50,
    });
    const messages = [];
    for (const { id } of list.data.messages || []) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: [party, 'Subject'],
      });
      const headers = {};
      for (const h of msg.data.payload?.headers || []) {
        headers[h.name.toLowerCase()] = h.value;
      }
      const who = headers[party.toLowerCase()] || '';
      messages.push({
        id,
        contact: displayName(who),
        email: extractEmail(who),
        subject: headers.subject || '(no subject)',
      });
    }
    return messages;
  } catch (err) {
    console.error(`gmail.recentMessages(${box}) failed:`, err.message);
    return [];
  }
}

async function tagWithProspects(messages) {
  const prospects = await readProspects();
  const byEmail = new Map();
  for (const p of prospects) {
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p);
  }
  return messages.map((m) => ({ ...m, prospect: byEmail.get(m.email) || null }));
}

// Inbound mail from the last `hours` hours, tagged with matching prospects.
export async function recentInboundTagged(hours) {
  return tagWithProspects(await recentMessages('inbox', 'From', hours));
}

// Sent mail from the last `hours` hours, tagged with matching prospects
// (matched by recipient address).
export async function recentOutboundTagged(hours) {
  return tagWithProspects(await recentMessages('sent', 'To', hours));
}
