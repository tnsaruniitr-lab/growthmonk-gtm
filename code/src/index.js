import http from 'node:http';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import cron from 'node-cron';
import { config } from './config.js';
import { dailyDigest, weeklyReview } from './reports.js';
import { answer } from './qna.js';
import { prospectReplies } from './gmail.js';

const bot = new Telegraf(config.telegram.token);

function sendToGroup(text) {
  const extra = { parse_mode: 'Markdown' };
  if (config.telegram.reportsTopicId) {
    extra.message_thread_id = Number(config.telegram.reportsTopicId);
  }
  return bot.telegram.sendMessage(config.telegram.groupId, text, extra);
}

bot.start((ctx) =>
  ctx.reply(
    "GrowthMonk bot is online. Ask about sales, marketing or this week's tasks. " +
      'Use /report, /week or /replies for instant summaries.'
  )
);

bot.command('report', async (ctx) => {
  await ctx.reply(await dailyDigest(), { parse_mode: 'Markdown' });
});

bot.command('week', async (ctx) => {
  await ctx.reply(await weeklyReview(), { parse_mode: 'Markdown' });
});

bot.command('replies', async (ctx) => {
  const replies = await prospectReplies(config.schedule.replyWindowHours);
  if (!replies.length) {
    await ctx.reply('No prospect replies in the recent window.');
    return;
  }
  await ctx.reply(
    replies.map((r) => `📨 ${r.prospect.business} — ${r.msg.subject}`).join('\n')
  );
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

const pingedReplies = new Set();
const stripMd = (s) => String(s).replace(/[*_`[\]]/g, '');

cron.schedule(
  config.schedule.replyCron,
  async () => {
    try {
      const replies = await prospectReplies(config.schedule.replyWindowHours);
      for (const { prospect, msg } of replies) {
        if (pingedReplies.has(msg.id)) continue;
        pingedReplies.add(msg.id);
        await sendToGroup(
          `📨 *Reply from ${stripMd(prospect.business)}*\n` +
            `${stripMd(prospect.email)}\n` +
            `Subject: ${stripMd(msg.subject)}\n${stripMd(msg.snippet)}`
        );
      }
    } catch (err) {
      console.error('reply check failed:', err.message);
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
