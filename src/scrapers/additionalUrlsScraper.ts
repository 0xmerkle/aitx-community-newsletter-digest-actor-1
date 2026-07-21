import { CheerioCrawler } from '@crawlee/cheerio';
import { Actor } from 'apify';

import { HTTP_CONCURRENCY, HTTP_TIMEOUT } from '../config.js';
import type { ActorInput, ArticleData } from '../types.js';
import { parseDate } from '../utils/dateNormalization.js';
import { extractArticleText } from '../utils/textExtraction.js';
import { normalizeUrl } from '../utils/urlNormalization.js';

export async function scrapeAdditionalUrls(input: ActorInput, limit: number, seenUrls: Set<string>): Promise<number> {
    if (!input.additionalUrls || input.additionalUrls.length === 0) {
        return 0;
    }

    let scrapedCount = 0;

    const crawler = new CheerioCrawler({
        maxConcurrency: HTTP_CONCURRENCY,
        requestHandlerTimeoutSecs: HTTP_TIMEOUT / 1000,
        async requestHandler({ request, $, log: crawlerLog }) {
            try {
                // Extract headline from title or h1
                let headline = $('title').text().trim();
                if (!headline) {
                    headline = $('h1').first().text().trim();
                }
                if (!headline) {
                    headline = 'Untitled';
                }

                // Extract article text
                const textContent = extractArticleText($);

                if (!textContent || textContent.length < 100) {
                    crawlerLog.warning('Article text too short, skipping', { url: request.url });
                    return;
                }

                // Extract source domain
                const sourceName = new URL(request.url).hostname.replace('www.', '');

                // Try to extract publish date
                const metaDate =
                    $('meta[property="article:published_time"]').attr('content') ||
                    $('meta[name="publish-date"]').attr('content') ||
                    $('time[datetime]').attr('datetime');

                // Try to extract description from meta tags
                const metaDescription =
                    $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="description"]').attr('content') ||
                    '';

                const articleData: ArticleData = {
                    type: 'article',
                    headline,
                    url: request.url,
                    text_content: textContent,
                    description: metaDescription || textContent.slice(0, 200),
                    published_date: parseDate(metaDate),
                    source_name: sourceName,
                    scraped_at: new Date().toISOString(),
                };

                await Actor.pushData(articleData);
                scrapedCount++;

                crawlerLog.info('Article scraped', { url: request.url, headline });
            } catch (error) {
                crawlerLog.error('Failed to scrape article', { url: request.url, error });
            }
        },
        async failedRequestHandler({ request, log: crawlerLog }) {
            crawlerLog.warning('Request failed', { url: request.url });
        },
    });

    // Add URLs to queue, skipping ones already scraped (e.g. via the RSS feed)
    const urlsToScrape = input.additionalUrls
        .filter((item) => {
            const normalized = normalizeUrl(item.url);
            if (seenUrls.has(normalized)) return false;
            seenUrls.add(normalized);
            return true;
        })
        .slice(0, limit);
    await crawler.addRequests(urlsToScrape.map((item) => ({ url: item.url })));

    await crawler.run();

    return scrapedCount;
}
