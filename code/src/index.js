import http from 'node:http';
import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import cron from 'node-cron';
import { config } from './config.js';
import { dailyDigest, weeklyReview } from './reports.js';
import { answer } from './qna.js';

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
      'Use /report or /week for instant summaries.'
  )
);

bot.command('report', async (ctx) => {
  await ctx.reply(await dailyDigest(), { parse_mode: 'Markdown' });
});

bot.command('week', async (ctx) => {
  await ctx.reply(await weeklyReview(), { parse_mode: 'Markdown' });
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

// Minimal health endpoint so Railway sees a live HTTP service.
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  })
  .listen(config.port, () => console.log(`health server listening on :${config.port}`));

// Guard: only launch once
let launched = false;
if (!launched) {
  launched = true;
  bot.launch().catch((err) => {
    console.error('bot launch failed:', err.message);
    process.exit(1);
  });
  console.log('GrowthMonk bot launched (long polling)');
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
