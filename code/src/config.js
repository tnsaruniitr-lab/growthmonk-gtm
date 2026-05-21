const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_GROUP_ID', 'OPENAI_API_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

// Builds a leads-API client from env vars with the given suffix
// ('' for client 1, '_2' for client 2). Returns null if no API key is set.
function leadsClient(suffix) {
  const apiKey = process.env[`LEADS_API_KEY${suffix}`];
  if (!apiKey) return null;
  const slug = process.env[`LEADS_API_SLUG${suffix}`] || 'shifahealthcare';
  return {
    slug,
    name: process.env[`LEADS_CLIENT_NAME${suffix}`] || slug,
    apiKey,
    apiBase:
      process.env[`LEADS_API_BASE${suffix}`] ||
      process.env.LEADS_API_BASE ||
      'https://growthmonk.ai',
  };
}

// Up to 10 leads clients: LEADS_* (client 1) and LEADS_*_2 … LEADS_*_10.
function leadsClients() {
  const suffixes = ['', ...Array.from({ length: 9 }, (_, i) => `_${i + 2}`)];
  return suffixes.map(leadsClient).filter(Boolean);
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
    emailCron: process.env.EMAIL_CRON || '0 */2 * * *',
    emailWindowHours: parseInt(process.env.EMAIL_WINDOW_HOURS || '3', 10),
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || null,
    sheetId: process.env.SHEET_ID || null,
  },
  leads: {
    cron: process.env.LEADS_CRON || '0 */2 * * *',
    clients: leadsClients(),
  },
  port: parseInt(process.env.PORT || '3000', 10),
};
