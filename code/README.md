# GrowthMonk Bot

Telegram bot for the GrowthMonk GTM team. Runs as an always-on service on Railway.

## What it does

- **Q&A** — answers questions in the Telegram group about the sales pipeline,
  marketing content and weekly tasks. OpenAI-backed, grounded only in this repo's data.
- **Scheduled reports** — posts a daily metrics digest and a Monday weekly review
  to the group.
- Reads GTM data **live from the public repo** over `raw.githubusercontent.com` —
  no GitHub token needed.

## Commands

- `/report` — daily digest on demand
- `/week` — weekly task review on demand
- any other message — natural-language Q&A

## Data it reads (from the repo root, not this folder)

- `pipeline/sales_pipeline.csv`
- `content/content_calendar.csv`
- `tasks/<ISO-week>/sales.md`, `tasks/<ISO-week>/marketing.md`

## Deploy on Railway

1. New project → Deploy from this GitHub repo.
2. Service settings:
   - **Root Directory:** `code`
   - **Watch Paths:** `code/**` — so edits to task/CSV data do not redeploy the bot.
3. Add environment variables (see `.env.example`):
   - required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_GROUP_ID`, `OPENAI_API_KEY`
   - optional: `TELEGRAM_REPORTS_TOPIC_ID`, `GITHUB_BRANCH`, `TIMEZONE`,
     `DAILY_CRON`, `WEEKLY_CRON`, `OPENAI_MODEL`
4. Deploy.

> Until this branch is merged to `main`, set `GITHUB_BRANCH` to the branch that
> holds the data files.

## Getting the Telegram group ID

Add the bot to the group, send any message there, then open:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

The `chat.id` (a negative number) is your `TELEGRAM_GROUP_ID`.

## Local development

```
cd code
cp .env.example .env   # fill in the values
npm install
npm start
```
