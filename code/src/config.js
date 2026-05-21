const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_GROUP_ID', 'OPENAI_API_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    groupId: process.env.TELEGRAM_GROUP_ID,
    reportsTopicId: process.env.TELEGRAM_REPORTS_TOPIC_ID || null,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  repo: {
    slug: process.env.GITHUB_REPO || 'tnsaruniitr-lab/growthmonk-gtm',
    branch: process.env.GITHUB_BRANCH || 'main',
  },
  schedule: {
    timezone: process.env.TIMEZONE || 'Asia/Dubai',
    daily: process.env.DAILY_CRON || '0 9 * * *',
    weekly: process.env.WEEKLY_CRON || '0 9 * * 1',
    inboundCron: process.env.INBOUND_CRON || '0 */2 * * *',
    inboundWindowHours: parseInt(process.env.INBOUND_WINDOW_HOURS || '3', 10),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
    sheetId: process.env.SHEET_ID || null,
  },
  port: parseInt(process.env.PORT || '3000', 10),
};
