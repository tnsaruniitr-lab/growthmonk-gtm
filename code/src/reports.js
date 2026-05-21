import { salesMetrics, marketingMetrics } from './metrics.js';
import { weekTasks, summarize } from './tasks.js';
import { readProspects, prospectStats } from './sheets.js';

export async function dailyDigest() {
  const s = await salesMetrics();
  const m = await marketingMetrics();
  const ps = prospectStats(await readProspects());
  const lines = [
    `📊 *Daily digest* — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `*Sales*`,
    `• Leads: ${s.leads}  ·  Contacted: ${s.contacted}  ·  Replied: ${s.replied}`,
    `• Calls booked: ${s.callBooked}  ·  Won: ${s.won}  ·  Lost: ${s.lost}`,
    ``,
    `*Marketing (content)*`,
    `• Total: ${m.total}  ·  Draft: ${m.draft}  ·  Scheduled: ${m.scheduled}  ·  Published: ${m.published}`,
  ];
  if (ps.total) {
    const tiers = Object.entries(ps.byTier)
      .sort()
      .map(([t, n]) => `${t}: ${n}`)
      .join('  ·  ');
    lines.push('', `*Prospects (Sheet)*`, `• Total: ${ps.total}  ·  ${tiers}`);
  }
  return lines.join('\n');
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
