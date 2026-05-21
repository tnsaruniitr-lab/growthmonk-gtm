import http from 'node:http';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import cron from 'node-cron';
import { config } from './config.js';
import { dailyDigest, weeklyReview } from './reports.js';
import { weekTasks } from './tasks.js';
import { answer } from './qna.js';
import { recentInboundTagged, recentOutboundTagged } from './gmail.js';
import { fetchLeads } from './leadsApi.js';
import { esc } from './format.js';
import { fetchFile } from './repo.js';

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
      const channel = channelLabel(normalizeChannel(lead.channel));
      lines.push(
        '',
        `${mark} <b>${esc(lead.name || 'Unknown')}</b>`,
        `   ${esc(channel)} · ${esc(detail)}`
      );
    }
    if (leads.length > 20) lines.push(`<i>…and ${leads.length - 20} more</i>`);
  }
  return lines.join('\n');
}

// Lists tasks (each tagged with .fn), grouped by owner with a gap between each.
function formatTasks(label, week, tasks) {
  const header = `📋 <b>Tasks · ${esc(label)}</b> · ${esc(week)}`;
  if (!tasks.length) return `${header}\n\nNo tasks found.`;
  const done = tasks.filter((t) => t.done).length;
  const lines = [`${header} — ${done}/${tasks.length} done`];
  const owners = [...new Set(tasks.map((t) => t.owner || 'unassigned'))].sort();
  for (const owner of owners) {
    lines.push('', `👤 <b>${esc(owner)}</b>`);
    for (const t of tasks.filter((x) => (x.owner || 'unassigned') === owner)) {
      const box = t.done ? '✅' : '☐';
      const meta = [t.fn, t.due && `due ${t.due}`, t.completion, t.link]
        .filter(Boolean)
        .join(' · ');
      lines.push('', `${box} ${esc(t.title)}`);
      if (meta) lines.push(`   ${esc(meta)}`);
    }
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
  '/tasks — task list (all, or by person: /tasks name)',
  '/demos — demo video links',
  '/inbox — recent received emails (prospects starred)',
  '/outbox — recent sent emails',
  '/leads — last-24h leads (all brands; or /leads_brand for one)',
  '/about — this guide',
  '',
  '<b>💬 Ask anything</b>',
  'In a group, @mention the bot or reply to its message to ask. In a ' +
    'direct chat, just type. It answers from the sheet, tasks and prospects.',
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

// /tasks = all tasks this week; /tasks <name> = filtered to that owner.
bot.command('tasks', async (ctx) => {
  const arg = (ctx.message.text.split(/\s+/)[1] || '').toLowerCase();
  const [sales, mkt] = await Promise.all([
    weekTasks('sales'),
    weekTasks('marketing'),
  ]);
  const all = [
    ...sales.tasks.map((t) => ({ ...t, fn: 'Sales' })),
    ...mkt.tasks.map((t) => ({ ...t, fn: 'Marketing' })),
  ];
  const tasks = arg
    ? all.filter((t) => (t.owner || '').toLowerCase() === arg)
    : all;
  await ctx.reply(formatTasks(arg || 'this week', sales.week, tasks), {
    parse_mode: 'HTML',
  });
});

// /demos = post the Loom links listed in demos.md.
bot.command('demos', async (ctx) => {
  const text = await fetchFile('demos.md');
  const items = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => `• ${esc(l.slice(2))}`);
  if (!items.length) {
    await ctx.reply('No demo links yet — add them to demos.md.');
    return;
  }
  await ctx.reply(`🎬 <b>Demo videos</b>\n\n${items.join('\n')}`, {
    parse_mode: 'HTML',
  });
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

const leadsCommand = (slug) =>
  `leads_${String(slug).toLowerCase().replace(/[^a-z0-9_]/g, '')}`;

async function replyLeads(ctx, clients) {
  if (!clients.length) {
    await ctx.reply('Leads API is not configured.');
    return;
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  for (const client of clients) {
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
}

// /leads = all brands; /leads_<slug> = one brand, auto-registered per client.
bot.command('leads', (ctx) => replyLeads(ctx, config.leads.clients));
for (const client of config.leads.clients) {
  bot.command(leadsCommand(client.slug), (ctx) => replyLeads(ctx, [client]));
}

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  // In groups, only answer when directly addressed — not normal chatter.
  const me = ctx.botInfo?.username || '';
  const directed =
    ctx.chat?.type === 'private' ||
    ctx.message.reply_to_message?.from?.id === ctx.botInfo?.id ||
    (me && text.toLowerCase().includes(`@${me.toLowerCase()}`));
  if (!directed) return;
  const question = me
    ? text.replace(new RegExp(`@${me}`, 'ig'), '').trim()
    : text.trim();
  if (!question) return;
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
console.log(
  `leads: ${config.leads.clients.length} client(s) — ` +
    (config.leads.clients.map((c) => `${c.slug}@${c.apiBase}`).join(', ') || 'none')
);

bot.telegram
  .setMyCommands([
    { command: 'about', description: 'What this bot does + command list' },
    { command: 'report', description: 'Daily sales + marketing digest' },
    { command: 'week', description: 'Weekly task progress' },
    { command: 'tasks', description: 'Task list (all, or by person: /tasks name)' },
    { command: 'demos', description: 'Demo video links' },
    { command: 'inbox', description: 'Recent received emails' },
    { command: 'outbox', description: 'Recent sent emails' },
    { command: 'leads', description: 'Leads — last 24h, all brands' },
    ...config.leads.clients.map((c) => ({
      command: leadsCommand(c.slug),
      description: `Leads — ${c.name}`,
    })),
  ])
  .catch((err) => console.error('setMyCommands failed:', err.message));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
