import { google } from 'googleapis';
import { googleClient } from './google.js';
import { readProspects } from './sheets.js';

function extractEmail(fromHeader) {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
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
      messages.push({
        id,
        from: headers.from || '',
        subject: headers.subject || '(no subject)',
        snippet: msg.data.snippet || '',
      });
    }
    return messages;
  } catch (err) {
    console.error('gmail.recentInbound failed:', err.message);
    return [];
  }
}

// Inbound messages from the last `hours` hours whose sender matches a
// prospect's email in the sheet. Returns [] if Gmail/Sheets aren't ready.
export async function prospectReplies(hours) {
  const [messages, prospects] = await Promise.all([
    recentInbound(hours),
    readProspects(),
  ]);
  const byEmail = new Map();
  for (const p of prospects) {
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p);
  }
  const matched = [];
  for (const msg of messages) {
    const prospect = byEmail.get(extractEmail(msg.from));
    if (prospect) matched.push({ prospect, msg });
  }
  return matched;
}
