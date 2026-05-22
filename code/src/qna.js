import OpenAI from 'openai';
import { config } from './config.js';
import { marketingMetrics } from './metrics.js';
import { weekTasks } from './tasks.js';
import { currentWeekId, fetchFile } from './repo.js';
import { readProspects, statusCounts } from './sheets.js';
import { recentInboundTagged, recentOutboundTagged } from './gmail.js';

const client = new OpenAI({ apiKey: config.openai.apiKey });

// Recent-email lookback window for Q&A context (hours).
const QA_EMAIL_HOURS = 24;

const SYSTEM = `You are the GrowthMonk GTM assistant. GrowthMonk sells AEO/SEO and
multichannel lead-management services to aesthetic clinics. Answer questions about
the Google Sheet (prospects), marketing content, weekly tasks, demo videos and recent email using ONLY the
context provided. Be concise and concrete. If the context does not contain the
answer, say so plainly rather than guessing.

Your context is assembled live from connected sources: the prospect list comes
from a Google Sheet (you can see every row — name, geo, tier, score, status, email),
weekly tasks and demo links from the GitHub repo, and recent email from a connected
Gmail account. You DO have access to these — if asked whether you can see the
spreadsheet, tasks, demos or email, the answer is yes.

When answering questions about prospects always refer to them by name and cite the
sheet data (status, geo, tier, score) directly. Never say "sales pipeline" without
also giving the specific names or numbers from the sheet.

Vocabulary: a "prospect" is a clinic GrowthMonk is selling to — these are in the
context below. A "lead" means a client's own inbound contact and is NOT in this
context; if asked about leads, say they are available via the /leads command.`;

async function gatherContext() {
  const [m, salesT, mktT, prospects, demos, inbound, outbound] = await Promise.all([
    marketingMetrics(),
    weekTasks('sales'),
    weekTasks('marketing'),
    readProspects(),
    fetchFile('demos.md'),
    recentInboundTagged(QA_EMAIL_HOURS),
    recentOutboundTagged(QA_EMAIL_HOURS),
  ]);
  const funnel = statusCounts(prospects);
  const prospectBlock = prospects.length
    ? `Google Sheet prospects (${prospects.length} rows — name, geo, decisionMaker, tier, score, email, status): ${JSON.stringify(prospects)}`
    : `Google Sheet prospects: 0 rows returned — the sheet may be empty or the connection failed.`;
  return [
    `Current week: ${currentWeekId()}`,
    `Google Sheet prospect summary by status: ${JSON.stringify(funnel.byStatus)}; ${funnel.total} total`,
    `Marketing metrics: ${JSON.stringify(m)}`,
    `Sales tasks this week: ${JSON.stringify(salesT.tasks)}`,
    `Marketing tasks this week: ${JSON.stringify(mktT.tasks)}`,
    prospectBlock,
    `Demo videos (title — Loom link):\n${demos || 'none'}`,
    `Recent inbound email (last ${QA_EMAIL_HOURS}h): ${JSON.stringify(inbound)}`,
    `Recent outbound email (last ${QA_EMAIL_HOURS}h): ${JSON.stringify(outbound)}`,
  ].join('\n');
}

export async function answer(question) {
  const context = await gatherContext();
  const res = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
    ],
  });
  return res.choices[0]?.message?.content?.trim() || 'No answer.';
}
