# AITX Newsletter Digest Scraper

An [Apify Actor](https://apify.com/actors) that scrapes AI news articles and events from multiple sources for the [AITX Community](https://aitx.beehiiv.com) weekly newsletter.

## What it does

Collects content from three sources and normalizes everything into a single Apify Dataset:

- **RSS feeds** — Scrapes article URLs with [CheerioCrawler](https://crawlee.dev/api/cheerio-crawler), falls back to RSS description for paywalled content
- **Lu.ma events** — Fetches events from Austin and Houston via Lu.ma's discover API (no browser needed)
- **Meetup events** — Calls the [Meetup Scraper](https://apify.com/filip_cicvarek/meetup-scraper) from the Apify Store via `Actor.call()`

## Pipeline

This Actor is the first half of a two-Actor pipeline. When it completes, a webhook triggers the [Newsletter Synthesizer](https://github.com/0xmerkle/aitx-community-newsletter-synthesizer-actor-2) with the Dataset ID.

    Actor 1 (this repo)          Actor 2
    ┌──────────────────┐         ┌──────────────────────┐
    │ Scrape RSS       │         │ Filter with Claude AI │
    │ Fetch Lu.ma API  │──webhook──▶│ Enrich Lu.ma events  │
    │ Call Meetup Actor │         │ Query Notion          │
    │ Normalize + push │         │ Generate draft        │
    └──────────────────┘         └──────────────────────┘

## Input

| Field | Type | Description |
|-------|------|-------------|
| `rssFeedUrl` | string | RSS feed URL to scrape articles from |
| `meetupCities` | array | Cities to search for Meetup events (default: Austin + Houston) |
| `meetupMaxResultsPerCity` | number | Max Meetup results per city (default: 10) |
| `maxArticles` | number | Max articles to fetch from RSS |
| `useProxies` | boolean | Use residential proxies (default: true) |

## Output

Items pushed to the default Dataset with a `type` field:

**Articles** (`type: "article"`):
```json
{
    "type": "article",
    "headline": "Texas AI startup raises $50M Series B",
    "url": "https://...",
    "text_content": "Full article text...",
    "source_name": "techcrunch.com",
    "scraped_at": "2026-02-20T10:00:00.000Z"
}
```

**Events** (`type: "event"`):
```json
{
    "type": "event",
    "source": "luma",
    "title": "AITX Monthly Meetup",
    "url": "https://lu.ma/aitx-feb26",
    "start_date": "2026-02-24T23:30:00.000Z",
    "end_date": "2026-02-25T01:30:00.000Z",
    "location": "800 Brazos St #340, Austin, TX 78701",
    "city": "Austin",
    "host_name": "AITX Community",
    "guest_count": 45,
    "is_free": true
}
```

## Local development

```bash
npm install
npm run start:dev    # Run locally with Apify CLI
npm run build        # TypeScript compile check
```

## Deployment

Connected to Apify via GitHub integration. Every push to `main` triggers an automatic build and deploy.

## Related

- **Actor 2:** [aitx-community-newsletter-synthesizer-actor-2](https://github.com/0xmerkle/aitx-community-newsletter-synthesizer-actor-2) — Filters, enriches, and generates the newsletter draft
