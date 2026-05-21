import OpenAI from 'openai';
import { config } from './config.js';
import { marketingMetrics } from './metrics.js';
import { weekTasks } from './tasks.js';
import { currentWeekId, fetchFile } from './repo.js';
import { readProspects, statusCounts } from './sheets.js';

const client = new OpenAI({ apiKey: config.openai.apiKey });

const SYSTEM = `You are the GrowthMonk GTM assistant. GrowthMonk sells AEO/SEO and
multichannel lead-management services to aesthetic clinics. Answer questions about
the team's sales pipeline, marketing content, weekly tasks and demo videos using ONLY the
context provided. Be concise and concrete. If the context does not contain the
answer, say so plainly rather than guessing.

Vocabulary: a "prospect" is a clinic GrowthMonk is selling to — these are in the
context below. A "lead" means a client's own inbound contact and is NOT in this
context; if asked about leads, say they are available via the /leads command.`;

async function gatherContext() {
  const [m, salesT, mktT, prospects, demos] = await Promise.all([
    marketingMetrics(),
    weekTasks('sales'),
    weekTasks('marketing'),
    readProspects(),
    fetchFile('demos.md'),
  ]);
  const funnel = statusCounts(prospects);
  return [
    `Current week: ${currentWeekId()}`,
    `Sales pipeline funnel (from the sales sheet): ${JSON.stringify(funnel.byStatus)}; ${funnel.total} prospects total`,
    `Marketing metrics: ${JSON.stringify(m)}`,
    `Sales tasks this week: ${JSON.stringify(salesT.tasks)}`,
    `Marketing tasks this week: ${JSON.stringify(mktT.tasks)}`,
    `Prospect list (${prospects.length}) from the sales sheet, each with a status: ${JSON.stringify(prospects)}`,
    `Demo videos (title — Loom link):\n${demos || 'none'}`,
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
