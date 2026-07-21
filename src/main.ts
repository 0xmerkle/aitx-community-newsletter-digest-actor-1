import { Actor, log } from 'apify';

import { scrapeAdditionalUrls } from './scrapers/additionalUrlsScraper.js';
import { scrapeLumaEvents } from './scrapers/lumaEventsScraper.js';
import { scrapeMeetupEvents } from './scrapers/meetupEventsScraper.js';
import { scrapeRssFeed } from './scrapers/rssFeedScraper.js';
import { validateInput } from './utils/validation.js';

await Actor.init();

// Graceful abort handler
Actor.on('aborting', async () => {
    log.info('Actor aborting, cleaning up...');
    await new Promise<void>((resolve) => { setTimeout(resolve, 1000); });
    await Actor.exit();
});

try {
    // Validate input
    const rawInput = await Actor.getInput();
    const input = validateInput(rawInput);

    log.info('Actor started', { input });

    // Track article counts manually (don't use Dataset.getInfo() per AGENTS.md)
    let totalArticles = 0;
    let totalEvents = 0;

    // Normalized article URLs already queued, shared across scrapers to prevent duplicates
    const seenArticleUrls = new Set<string>();

    // Run scrapers with error isolation
    try {
        log.info('Starting RSS feed scraper...');
        const rssCount = await scrapeRssFeed(input, input.maxArticles! - totalArticles, seenArticleUrls);
        totalArticles += rssCount;
        log.info(`RSS scraper completed: ${rssCount} articles`);
    } catch (error) {
        log.error('RSS feed scraper failed', { error });
    }

    if (input.additionalUrls && input.additionalUrls.length > 0 && totalArticles < input.maxArticles!) {
        try {
            log.info('Starting additional URLs scraper...');
            const additionalCount = await scrapeAdditionalUrls(input, input.maxArticles! - totalArticles, seenArticleUrls);
            totalArticles += additionalCount;
            log.info(`Additional URLs completed: ${additionalCount} articles`);
        } catch (error) {
            log.error('Additional URLs scraper failed', { error });
        }
    }

    if (input.lumaEventUrls && input.lumaEventUrls.length > 0) {
        try {
            log.info('Starting Lu.ma events scraper...');
            const lumaCount = await scrapeLumaEvents(input);
            totalEvents += lumaCount;
            log.info(`Lu.ma scraper completed: ${lumaCount} events`);
        } catch (error) {
            log.error('Lu.ma events scraper failed', { error });
        }
    }

    if (input.meetupCities && input.meetupCities.length > 0) {
        try {
            log.info('Starting Meetup events scraper...');
            const meetupCount = await scrapeMeetupEvents(input);
            totalEvents += meetupCount;
            log.info(`Meetup scraper completed: ${meetupCount} events`);
        } catch (error) {
            log.error('Meetup events scraper failed', { error });
        }
    }

    // Save webhook payload to KV store
    const webhookPayload = {
        datasetId: Actor.getEnv().defaultDatasetId || 'local-run',
        articlesScraped: totalArticles,
        eventsScraped: totalEvents,
        scrapedAt: new Date().toISOString(),
        runningLocally: !Actor.getEnv().defaultDatasetId,
    };

    await Actor.setValue('WEBHOOK_PAYLOAD', webhookPayload);

    log.info('Actor completed', { totalArticles, totalEvents });
} catch (error) {
    log.error('Actor failed', { error });
    throw error;
}

await Actor.exit();
