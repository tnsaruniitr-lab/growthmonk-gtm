import { marketingMetrics } from './metrics.js';
import { weekTasks, summarize } from './tasks.js';
import { readProspects, statusCounts } from './sheets.js';
import { esc } from './format.js';

const FUNNEL_EMOJI = {
  'Not contacted': '⬜',
  Mailed: '✉️',
  Responded: '💬',
  Booked: '✅',
  Dead: '⚫',
};

// A 10-cell text progress bar.
function bar(pct) {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 10);
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

export async function dailyDigest() {
  const funnel = statusCounts(await readProspects());
  const m = await marketingMetrics();
  const salesLine = funnel.byStatus
    .map((x) => `${FUNNEL_EMOJI[x.status] || '•'} ${x.count} ${x.status.toLowerCase()}`)
    .join('   ');
  return [
    `📊 <b>Daily Digest</b> · ${new Date().toISOString().slice(0, 10)}`,
    '',
    `💼 <b>Sales pipeline</b> · ${funnel.total} prospects`,
    `   ${salesLine}`,
    '',
    `📣 <b>Marketing</b> · ${m.total} content items`,
    `   💡 ${m.ideas} ideas   ✏️ ${m.draft} draft   📅 ${m.scheduled} scheduled   🚀 ${m.published} published`,
  ].join('\n');
}

export async function weeklyReview() {
  const sales = await weekTasks('sales');
  const mkt = await weekTasks('marketing');
  const ss = summarize(sales.tasks);
  const ms = summarize(mkt.tasks);
  const lines = [
    `🗓 <b>Weekly Review</b> · ${sales.week}`,
    '',
    `💼 <b>Sales tasks</b>`,
    `   ${bar(ss.completion)}  ${ss.done}/${ss.total} (${ss.completion}%)`,
    `📣 <b>Marketing tasks</b>`,
    `   ${bar(ms.completion)}  ${ms.done}/${ms.total} (${ms.completion}%)`,
  ];
  const overdue = [...ss.overdue, ...ms.overdue];
  if (overdue.length) {
    lines.push('', `⚠️ <b>Overdue (${overdue.length})</b>`);
    for (const t of overdue.slice(0, 10)) {
      lines.push(`• ${esc(t.title)} <i>(due ${esc(t.due)})</i>`);
    }
  }
  return lines.join('\n');
}
