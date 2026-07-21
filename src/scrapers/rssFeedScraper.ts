import { CheerioCrawler } from '@crawlee/cheerio';
import { Actor, log } from 'apify';
import Parser from 'rss-parser';

import { HTTP_CONCURRENCY, HTTP_TIMEOUT } from '../config.js';
import type { ActorInput, ArticleData } from '../types.js';
import { parseDate } from '../utils/dateNormalization.js';
import { extractArticleText } from '../utils/textExtraction.js';
import { normalizeUrl } from '../utils/urlNormalization.js';

export async function scrapeRssFeed(input: ActorInput, limit: number, seenUrls: Set<string>): Promise<number> {
    if (limit <= 0) {
        return 0;
    }

    let scrapedCount = 0;

    // Parse RSS feed
    const parser = new Parser();
    let feed;

    try {
        feed = await parser.parseURL(input.rssFeedUrl);
        log.info('RSS feed parsed', { title: feed.title, itemCount: feed.items.length });
    } catch (error) {
        log.error('Failed to parse RSS feed', { url: input.rssFeedUrl, error });
        throw error;
    }

    const crawler = new CheerioCrawler({
        maxConcurrency: HTTP_CONCURRENCY,
        requestHandlerTimeoutSecs: HTTP_TIMEOUT / 1000,
        async requestHandler({ request, $, log: crawlerLog }) {
            try {
                const userData = request.userData as {
                    headline: string;
                    publishDate?: string;
                    rssContent: string;
                    rssDescription?: string;
                };

                let textContent: string;

                try {
                    // Try to extract full article text from page
                    textContent = extractArticleText($);

                    // If extracted text is too short, fall back to RSS content
                    if (textContent.length < 100 && userData.rssContent) {
                        crawlerLog.info('Extracted text too short, using RSS fallback', { url: request.url });
                        textContent = userData.rssContent;
                    }
                } catch (error) {
                    crawlerLog.warning('Scrape failed, using RSS fallback', { url: request.url, error });
                    textContent = userData.rssContent;
                }

                if (!textContent || textContent.length < 50) {
                    crawlerLog.warning('No content available, skipping', { url: request.url });
                    return;
                }

                // Extract source domain
                const sourceName = new URL(request.url).hostname.replace('www.', '');

                const articleData: ArticleData = {
                    type: 'article',
                    headline: userData.headline,
                    url: request.url,
                    text_content: textContent,
                    description: userData.rssDescription || textContent.slice(0, 200),
                    published_date: parseDate(userData.publishDate),
                    source_name: sourceName,
                    scraped_at: new Date().toISOString(),
                };

                await Actor.pushData(articleData);
                scrapedCount++;

                crawlerLog.info('RSS article scraped', { url: request.url, headline: userData.headline });
            } catch (error) {
                crawlerLog.error('Failed to process RSS article', { url: request.url, error });
            }
        },
        async failedRequestHandler({ request, log: crawlerLog }) {
            const userData = request.userData as {
                headline: string;
                rssContent: string;
                publishDate?: string;
            };
            crawlerLog.warning('Request failed, attempting to use RSS content only', { url: request.url });

            // Even if the request fails, try to save RSS content
            if (userData.rssContent && userData.rssContent.length > 50) {
                try {
                    const sourceName = new URL(request.url).hostname.replace('www.', '');

                    const articleData: ArticleData = {
                        type: 'article',
                        headline: userData.headline,
                        url: request.url,
                        text_content: userData.rssContent,
                        description: userData.rssContent.slice(0, 200),
                        published_date: parseDate(userData.publishDate),
                        source_name: sourceName,
                        scraped_at: new Date().toISOString(),
                    };

                    await Actor.pushData(articleData);
                    scrapedCount++;

                    crawlerLog.info('Saved RSS content for failed request', { url: request.url });
                } catch (error) {
                    crawlerLog.error('Failed to save RSS content', { url: request.url, error });
                }
            }
        },
    });

    // Add URLs to queue with RSS content in userData, skipping duplicates
    const requests = feed.items
        .map((item) => ({
            url: item.link || item.guid || '',
            userData: {
                headline: item.title || 'Untitled',
                publishDate: item.pubDate || item.isoDate,
                rssContent: item.contentSnippet || item.content || item.description || '',
                rssDescription: (item.contentSnippet || item.description || '').slice(0, 200),
            },
        }))
        .filter((req) => {
            if (!req.url) return false;
            const normalized = normalizeUrl(req.url);
            if (seenUrls.has(normalized)) {
                log.debug('RSS: Skipping duplicate URL', { url: req.url });
                return false;
            }
            seenUrls.add(normalized);
            return true;
        })
        .slice(0, limit);

    await crawler.addRequests(requests);
    await crawler.run();

    return scrapedCount;
}
