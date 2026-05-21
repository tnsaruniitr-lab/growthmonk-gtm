import { marketingMetrics } from './metrics.js';
import { weekTasks, summarize } from './tasks.js';
import { readProspects, statusCounts } from './sheets.js';

export async function dailyDigest() {
  const funnel = statusCounts(await readProspects());
  const m = await marketingMetrics();
  const salesLine = funnel.byStatus
    .map((x) => `${x.status}: ${x.count}`)
    .join('  ·  ');
  return [
    `📊 *Daily digest* — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `*Sales pipeline (${funnel.total})*`,
    `• ${salesLine}`,
    ``,
    `*Marketing (content)*`,
    `• Total: ${m.total}  ·  Draft: ${m.draft}  ·  Scheduled: ${m.scheduled}  ·  Published: ${m.published}`,
  ].join('\n');
}

export async function weeklyReview() {
  const sales = await weekTasks('sales');
  const mkt = await weekTasks('marketing');
  const ss = summarize(sales.tasks);
  const ms = summarize(mkt.tasks);
  const lines = [
    `🗓 *Weekly review* — ${sales.week}`,
    ``,
    `*Sales tasks:* ${ss.done}/${ss.total} done (${ss.completion}%)`,
    `*Marketing tasks:* ${ms.done}/${ms.total} done (${ms.completion}%)`,
  ];
  const overdue = [...ss.overdue, ...ms.overdue];
  if (overdue.length) {
    lines.push('', `⚠️ *Overdue (${overdue.length})*`);
    for (const t of overdue.slice(0, 10)) {
      lines.push(`• ${t.title} (due ${t.due})`);
    }
  }
  return lines.join('\n');
}
