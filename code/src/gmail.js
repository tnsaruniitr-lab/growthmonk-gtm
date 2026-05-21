import { google } from 'googleapis';
import { googleClient } from './google.js';
import { readProspects } from './sheets.js';

function extractEmail(fromHeader) {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

// Display name from a From header ("Name <email>"), or the email itself.
function senderName(fromHeader) {
  const m = fromHeader.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : fromHeader).trim();
}

// Inbox messages received within the last `hours` hours.
async function recentInbound(hours) {
  const auth = googleClient();
  if (!auth) return [];
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const after = Math.floor(Date.now() / 1000) - hours * 3600;
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `in:inbox after:${after}`,
      maxResults: 50,
    });
    const messages = [];
    for (const { id } of list.data.messages || []) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject'],
      });
      const headers = {};
      for (const h of msg.data.payload?.headers || []) {
        headers[h.name.toLowerCase()] = h.value;
      }
      const from = headers.from || '';
      messages.push({
        id,
        sender: senderName(from),
        email: extractEmail(from),
        subject: headers.subject || '(no subject)',
      });
    }
    return messages;
  } catch (err) {
    console.error('gmail.recentInbound failed:', err.message);
    return [];
  }
}

// All inbound from the last `hours` hours, each tagged with the matching
// prospect if the sender's email is a known prospect.
// Returns [] if Gmail/Sheets aren't ready.
export async function recentInboundTagged(hours) {
  const [messages, prospects] = await Promise.all([
    recentInbound(hours),
    readProspects(),
  ]);
  const byEmail = new Map();
  for (const p of prospects) {
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p);
  }
  return messages.map((msg) => ({
    ...msg,
    prospect: byEmail.get(msg.email) || null,
  }));
}
