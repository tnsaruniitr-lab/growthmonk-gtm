import http from 'node:http';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import cron from 'node-cron';
import { config } from './config.js';
import { dailyDigest, weeklyReview } from './reports.js';
import { answer } from './qna.js';
import { recentInboundTagged, recentOutboundTagged } from './gmail.js';
import { fetchLeads } from './leadsApi.js';

const bot = new Telegraf(config.telegram.token);

function sendToGroup(text) {
  const extra = { parse_mode: 'Markdown' };
  if (config.telegram.reportsTopicId) {
    extra.message_thread_id = Number(config.telegram.reportsTopicId);
  }
  return bot.telegram.sendMessage(config.telegram.groupId, text, extra);
}

const stripMd = (s) => String(s).replace(/[*_`[\]]/g, '');

// Formats one section (inbound or outbound) — prospects starred and first.
function formatSection(emoji, label, messages) {
  const prospects = messages.filter((m) => m.prospect);
  const others = messages.filter((m) => !m.prospect);
  const ordered = [...prospects, ...others];
  const lines = [`${emoji} *${label} (${messages.length})*`];
  for (const m of ordered.slice(0, 20)) {
    const who = m.prospect
      ? `${stripMd(m.prospect.business)} (prospect)`
      : stripMd(m.contact);
    lines.push(`${m.prospect ? '⭐' : '•'} ${who} — ${stripMd(m.subject)}`);
  }
  if (ordered.length > 20) lines.push(`…and ${ordered.length - 20} more`);
  return lines.join('\n');
}

// Formats a GrowthMonk leads-API payload into a digest.
function formatLeadsDigest(client, data, label) {
  const s = data.summary || {};
  const lines = [`🔔 *${label} — ${stripMd(client.name)} (${s.total || 0})*`];
  const channels = Object.entries(s.by_channel || {})
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
  if (channels) lines.push(channels);
  lines.push(
    `High intent ${s.high_intent || 0} · Booked ${s.booked || 0} · ` +
      `Appointments ${s.appointments_raised || 0} · Not replied ${s.not_replied || 0}`
  );
  const leads = data.leads || [];
  for (const lead of leads.slice(0, 20)) {
    const bits = [lead.name, lead.channel, lead.status, lead.notes]
      .filter(Boolean)
      .map(stripMd)
      .join(' — ');
    lines.push(`• ${bits}`);
  }
  if (leads.length > 20) lines.push(`…and ${leads.length - 20} more`);
  return lines.join('\n');
}

bot.start((ctx) =>
  ctx.reply(
    "GrowthMonk bot is online. Ask about sales, marketing or this week's tasks. " +
      'Use /report, /week, /inbox, /outbox or /leads for instant summaries.'
  )
);

bot.command('report', async (ctx) => {
  await ctx.reply(await dailyDigest(), { parse_mode: 'Markdown' });
});

bot.command('week', async (ctx) => {
  await ctx.reply(await weeklyReview(), { parse_mode: 'Markdown' });
});

bot.command('inbox', async (ctx) => {
  const messages = await recentInboundTagged(config.schedule.emailWindowHours);
  if (!messages.length) {
    await ctx.reply('No inbound email in the recent window.');
    return;
  }
  await ctx.reply(formatSection('📥', 'Inbound', messages), { parse_mode: 'Markdown' });
});

bot.command('outbox', async (ctx) => {
  const messages = await recentOutboundTagged(config.schedule.emailWindowHours);
  if (!messages.length) {
    await ctx.reply('No outbound email in the recent window.');
    return;
  }
  await ctx.reply(formatSection('📤', 'Outbound', messages), { parse_mode: 'Markdown' });
});

bot.command('leads', async (ctx) => {
  if (!config.leads.clients.length) {
    await ctx.reply('Leads API is not configured.');
    return;
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  for (const client of config.leads.clients) {
    const result = await fetchLeads(client, { overrideSince: since });
    if (!result.ok) {
      await ctx.reply(`⚠️ ${client.name}: ${result.error}`);
      continue;
    }
    if (!result.data.summary?.total) {
      await ctx.reply(`${client.name}: no leads in the last 24h.`);
      continue;
    }
    await ctx.reply(formatLeadsDigest(client, result.data, 'Leads — last 24h'), {
      parse_mode: 'Markdown',
    });
  }
});

bot.on(message('text'), async (ctx) => {
  const question = ctx.message.text;
  if (question.startsWith('/')) return;
  try {
    await ctx.sendChatAction('typing');
    await ctx.reply(await answer(question));
  } catch (err) {
    console.error('qna error:', err.message);
    await ctx.reply('Sorry, I hit an error answering that.');
  }
});

function scheduleReport(expr, build) {
  cron.schedule(
    expr,
    async () => {
      try {
        await sendToGroup(await build());
      } catch (err) {
        console.error('scheduled report failed:', err.message);
      }
    },
    { timezone: config.schedule.timezone }
  );
}

scheduleReport(config.schedule.daily, dailyDigest);
scheduleReport(config.schedule.weekly, weeklyReview);

// Email digest: every couple of hours, post inbound + outbound not yet reported.
const seenMessages = new Set();
cron.schedule(
  config.schedule.emailCron,
  async () => {
    try {
      const [inbound, outbound] = await Promise.all([
        recentInboundTagged(config.schedule.emailWindowHours),
        recentOutboundTagged(config.schedule.emailWindowHours),
      ]);
      const freshIn = inbound.filter((m) => !seenMessages.has(m.id));
      const freshOut = outbound.filter((m) => !seenMessages.has(m.id));
      if (!freshIn.length && !freshOut.length) return;
      for (const m of [...freshIn, ...freshOut]) seenMessages.add(m.id);
      const parts = [];
      if (freshIn.length) parts.push(formatSection('📥', 'Inbound', freshIn));
      if (freshOut.length) parts.push(formatSection('📤', 'Outbound', freshOut));
      await sendToGroup(parts.join('\n\n'));
    } catch (err) {
      console.error('email digest failed:', err.message);
    }
  },
  { timezone: config.schedule.timezone }
);

// Leads digest: every couple of hours, pull new leads per client and post.
cron.schedule(
  config.leads.cron,
  async () => {
    for (const client of config.leads.clients) {
      try {
        const result = await fetchLeads(client);
        if (!result.ok) {
          console.error(`leads fetch failed (${client.slug}):`, result.error);
          if (result.fatal) {
            await sendToGroup(`⚠️ Leads API error — ${client.name}: ${result.error}`);
          }
          continue;
        }
        if (!result.data.summary?.total) continue;
        await sendToGroup(formatLeadsDigest(client, result.data, 'New leads'));
      } catch (err) {
        console.error(`leads cron error (${client.slug}):`, err.message);
      }
    }
  },
  { timezone: config.schedule.timezone }
);

// Minimal health endpoint so Railway sees a live HTTP service.
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  })
  .listen(config.port, () => console.log(`health server listening on :${config.port}`));

bot.launch().catch((err) => {
  console.error('bot launch failed:', err.message);
  process.exit(1);
});
console.log('GrowthMonk bot launched (long polling)');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
