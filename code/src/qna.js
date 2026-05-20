import OpenAI from 'openai';
import { config } from './config.js';
import { salesMetrics, marketingMetrics } from './metrics.js';
import { weekTasks } from './tasks.js';
import { currentWeekId } from './repo.js';

const client = new OpenAI({ apiKey: config.openai.apiKey });

const SYSTEM = `You are the GrowthMonk GTM assistant. GrowthMonk sells AEO/SEO and
multichannel lead-management services to aesthetic clinics. Answer questions about
the team's sales pipeline, marketing content and weekly tasks using ONLY the
context provided. Be concise and concrete. If the context does not contain the
answer, say so plainly rather than guessing.`;

async function gatherContext() {
  const [s, m, salesT, mktT] = await Promise.all([
    salesMetrics(),
    marketingMetrics(),
    weekTasks('sales'),
    weekTasks('marketing'),
  ]);
  return [
    `Current week: ${currentWeekId()}`,
    `Sales metrics: ${JSON.stringify(s)}`,
    `Marketing metrics: ${JSON.stringify(m)}`,
    `Sales tasks this week: ${JSON.stringify(salesT.tasks)}`,
    `Marketing tasks this week: ${JSON.stringify(mktT.tasks)}`,
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
