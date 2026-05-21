import http from 'node:http';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import cron from 'node-cron';
import { config } from './config.js';
import { dailyDigest, weeklyReview } from './reports.js';
import { answer } from './qna.js';
import { recentInboundTagged, recentOutboundTagged } from './gmail.js';
import { fetchLeads } from './leadsApi.js';
import { esc } from './format.js';

const bot = new Telegraf(config.telegram.token);

const CHANNEL_EMOJI = {
  instagram: '📷',
  facebook: '📘',
  whatsapp: '💬',
  direct: '✉️',
  unknown: '❓',
};

const LEAD_STATUS_EMOJI = {
  new: '🆕',
  qualified: '👍',
  callback_booked: '📞',
  appointment_booked: '✅',
  escalated: '🔺',
  needs_human: '🙋',
  closed: '⚪',
};

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

const CHANNEL_NAME = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  direct: 'Direct',
  unknown: 'Unknown',
};

const channelLabel = (ch) => CHANNEL_NAME[ch] || cap(ch || 'unknown');

// Legacy leads were stored as "direct"; treat it as WhatsApp.
const normalizeChannel = (ch) => (ch === 'direct' ? 'whatsapp' : ch || 'unknown');

// Merges a by-channel count map after normalising channel keys.
function mergeChannels(byChannel) {
  const out = {};
  for (const [ch, count] of Object.entries(byChannel || {})) {
    const key = normalizeChannel(ch);
    out[key] = (out[key] || 0) + count;
  }
  return out;
}

function sendToGroup(text) {
  const extra = { parse_mode: 'HTML' };
  if (config.telegram.reportsTopicId) {
    extra.message_thread_id = Number(config.telegram.reportsTopicId);
  }
  return bot.telegram.sendMessage(config.telegram.groupId, text, extra);
}

// Formats one email section (inbound or outbound) — prospects starred, first.
function formatSection(emoji, label, messages) {
  const prospects = messages.filter((m) => m.prospect);
  const others = messages.filter((m) => !m.prospect);
  const ordered = [...prospects, ...others];
  const lines = [`${emoji} <b>${esc(label)}</b> · ${messages.length}`];
  for (const m of ordered.slice(0, 20)) {
    const mark = m.prospect ? '⭐' : '•';
    const who = m.prospect ? m.prospect.business : m.contact;
    lines.push(`${mark} <b>${esc(who)}</b> — ${esc(m.subject)}`);
  }
  if (ordered.length > 20) lines.push(`<i>…and ${ordered.length - 20} more</i>`);
  return lines.join('\n');
}

// Formats a GrowthMonk leads-API payload into a digest.
function formatLeadsDigest(client, data, label) {
  const s = data.summary || {};
  const lines = [
    `🔔 <b>${esc(label)}</b> · ${esc(client.name)}`,
    '',
    `📊 ${s.total || 0} new   🔥 ${s.high_intent || 0} high-intent   ` +
      `📅 ${s.booked || 0} booked   ⏳ ${s.not_replied || 0} not replied`,
  ];
  const channelLine = Object.entries(mergeChannels(s.by_channel))
    .map(([k, v]) => `${CHANNEL_EMOJI[k] || '❓'} ${esc(channelLabel(k))} ${v}`)
    .join('   ');
  if (channelLine) lines.push(channelLine);
  const leads = data.leads || [];
  if (leads.length) {
    lines.push('──────────────');
    for (const lead of leads.slice(0, 20)) {
      const mark = LEAD_STATUS_EMOJI[lead.status] || '•';
      // service_requested / city are null until the bot has engaged the lead
      const extra = [lead.service_requested, lead.city].filter(Boolean);
      const detail = extra.length ? extra.join(' · ') : '(not yet engaged)';
      lines.push(
        `${mark} <b>${esc(lead.name || 'Unknown')}</b> · ` +
          `${esc(channelLabel(normalizeChannel(lead.channel)))} · ${esc(detail)}`
      );
    }
    if (leads.length > 20) lines.push(`<i>…and ${leads.length - 20} more</i>`);
  }
  return lines.join('\n');
}

const ABOUT = [
  '🌱 <b>GrowthMonk Ops Bot</b>',
  '',
  "This group is GrowthMonk's go-to-market command centre — sales pipeline, " +
    'marketing content, weekly tasks, email activity and incoming leads, all in one place.',
  '',
  '<b>📋 Commands</b>',
  '/report — daily snapshot: sales pipeline + marketing',
  '/week — weekly task progress (sales &amp; marketing)',
  '/inbox — recent received emails (prospects starred)',
  '/outbox — recent sent emails',
  '/leads — leads from the last 24 hours',
  '/about — this guide',
  '',
  '<b>💬 Ask anything</b>',
  'Type a plain question and the bot answers from the sheet, tasks and ' +
    'prospect data — e.g. "how many prospects in Berlin?" or "what is overdue?"',
  '',
  '<b>⏰ Automatic updates</b>',
  '• Daily digest — every morning',
  '• Weekly review — Monday mornings',
  '• Email digest — every 2 hours (inbound + outbound)',
  '• New leads — every 2 hours',
].join('\n');

bot.start((ctx) =>
  ctx.reply(
    '👋 GrowthMonk Ops Bot is online. Type /about for what this group does and the full command list.'
  )
);

bot.command('about', async (ctx) => {
  await ctx.reply(ABOUT, { parse_mode: 'HTML' });
});

bot.command('report', async (ctx) => {
  await ctx.reply(await dailyDigest(), { parse_mode: 'HTML' });
});

bot.command('week', async (ctx) => {
  await ctx.reply(await weeklyReview(), { parse_mode: 'HTML' });
});

bot.command('inbox', async (ctx) => {
  const messages = await recentInboundTagged(config.schedule.emailWindowHours);
  if (!messages.length) {
    await ctx.reply('No inbound email in the recent window.');
    return;
  }
  await ctx.reply(formatSection('📥', 'Inbound', messages), { parse_mode: 'HTML' });
});

bot.command('outbox', async (ctx) => {
  const messages = await recentOutboundTagged(config.schedule.emailWindowHours);
  if (!messages.length) {
    await ctx.reply('No outbound email in the recent window.');
    return;
  }
  await ctx.reply(formatSection('📤', 'Outbound', messages), { parse_mode: 'HTML' });
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
      await ctx.reply(`⚠️ ${client.name}: ${result.error}\nURL: ${result.url}`);
      continue;
    }
    if (!result.data.summary?.total) {
      await ctx.reply(`${client.name}: no leads in the last 24h.`);
      continue;
    }
    await ctx.reply(formatLeadsDigest(client, result.data, 'Leads · last 24h'), {
      parse_mode: 'HTML',
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
          console.error(`leads fetch failed (${client.slug}):`, result.error, result.url);
          if (result.fatal) {
            await sendToGroup(
              `⚠️ <b>Leads API error</b> — ${esc(client.name)}: ${esc(result.error)}`
            );
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
console.log(`leads: ${config.leads.clients.length} client(s), base ${config.leads.apiBase}`);

bot.telegram
  .setMyCommands([
    { command: 'about', description: 'What this bot does + command list' },
    { command: 'report', description: 'Daily sales + marketing digest' },
    { command: 'week', description: 'Weekly task progress' },
    { command: 'inbox', description: 'Recent received emails' },
    { command: 'outbox', description: 'Recent sent emails' },
    { command: 'leads', description: 'Leads from the last 24 hours' },
  ])
  .catch((err) => console.error('setMyCommands failed:', err.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
