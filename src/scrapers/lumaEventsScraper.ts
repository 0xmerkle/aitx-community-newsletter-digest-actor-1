import { PlaywrightCrawler } from '@crawlee/playwright';
import { Actor, log } from 'apify';
import type { Page } from 'playwright';

import type { ActorInput, EventData } from '../types.js';
import { deduplicateByUrl } from '../utils/urlNormalization.js';

/** Map Lu.ma URL slugs to city/state info */
const CITY_MAP: Record<string, { city: string; state: string }> = {
    austin: { city: 'Austin', state: 'TX' },
    'austin-ai': { city: 'Austin', state: 'TX' },
    houston: { city: 'Houston', state: 'TX' },
    'houston-ai': { city: 'Houston', state: 'TX' },
    dallas: { city: 'Dallas', state: 'TX' },
    dfw: { city: 'Dallas', state: 'TX' },
    'san-antonio': { city: 'San Antonio', state: 'TX' },
};

/** Infer city/state from a Lu.ma URL like https://lu.ma/austin or https://lu.ma/austin-ai */
function inferCityFromUrl(url: string): { city: string; state: string } {
    try {
        const slug = new URL(url).pathname.replace(/^\//, '').split('/')[0].toLowerCase();
        return CITY_MAP[slug] || { city: '', state: '' };
    } catch {
        return { city: '', state: '' };
    }
}

/**
 * Parse Lu.ma date headers like "Thu, Feb 13" or "Saturday, February 15" into ISO format.
 * Lu.ma omits the year, so we infer current year (or next year if the date already passed).
 */
function parseLumaDateHeader(dateText: string): string {
    if (!dateText || dateText.trim() === '') return '';

    if (/^tomorrow$/i.test(dateText.trim())) {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
    }
    if (/^today$/i.test(dateText.trim())) {
        return new Date().toISOString().slice(0, 10);
    }

    const cleaned = dateText.replace(/^[A-Za-z]+,\s*/, '').trim();

    // Handle ISO format directly (e.g., "2026-02-13")
    if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
        return cleaned.slice(0, 10);
    }

    const monthMap: Record<string, string> = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12',
        january: '01',
        february: '02',
        march: '03',
        april: '04',
        june: '06',
        july: '07',
        august: '08',
        september: '09',
        october: '10',
        november: '11',
        december: '12',
    };

    const parts = cleaned.split(/\s+/);
    if (parts.length < 2) return '';

    const month = monthMap[parts[0].toLowerCase()] || '';
    const day = parts[1].replace(/\D/g, '').padStart(2, '0');

    if (!month || !day) return '';

    // Check if year is explicitly provided (e.g., "February 13, 2026")
    const yearMatch = cleaned.match(/\b(20\d{2})\b/);
    if (yearMatch) {
        return `${yearMatch[1]}-${month}-${day}`;
    }

    // Infer year — assume current year unless the date is >7 days in the past
    const now = new Date();
    const currentYear = now.getFullYear();
    const testDate = new Date(`${currentYear}-${month}-${day}`);
    const year = testDate < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) ? currentYear + 1 : currentYear;

    return `${year}-${month}-${day}`;
}

/** Parse "6:00 PM" → "18:00", "10:30 AM" → "10:30" */
function parseTimeString(timeText: string): string {
    const match = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return '';

    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

/** Strip zero-width characters, newlines, and normalize whitespace */
function sanitizeText(text: string): string {
    return text
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // eslint-disable-line no-misleading-character-class
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Extract venue name from location text like "Capital Factory, Austin, TX" */
function extractVenueName(locationText: string): string {
    if (!locationText) return '';
    const venue = sanitizeText(locationText.split(',')[0].trim());

    // Reject bare city names — not useful as venue info
    const bareNames = ['austin', 'houston', 'dallas', 'san antonio', 'fort worth'];
    if (bareNames.includes(venue.toLowerCase())) return '';

    return venue;
}

/** Scroll the page to trigger Lu.ma's infinite-scroll loader and load all events */
async function scrollToLoadAllEvents(page: Page): Promise<void> {
    let previousCardCount = 0;
    let attempts = 0;
    const MAX_SCROLL_ATTEMPTS = 10;

    while (attempts < MAX_SCROLL_ATTEMPTS) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);

        const currentCardCount = await page.locator('.card-wrapper').count();

        if (currentCardCount === previousCardCount) {
            break;
        }

        previousCardCount = currentCardCount;
        attempts++;
    }

    log.info(`Lu.ma: Scrolling complete, ${previousCardCount} cards loaded after ${attempts} scroll(s)`);
}

/** Extract all events from timeline sections on a Lu.ma listing page */
async function extractEventsFromListingPage(
    page: Page,
    cityInfo: { city: string; state: string },
): Promise<EventData[]> {
    const events: EventData[] = [];
    const sections = page.locator('.timeline-section');
    const sectionCount = await sections.count();

    for (let i = 0; i < sectionCount; i++) {
        const section = sections.nth(i);

        // Diagnostic logging — check which selector yields the date text
        const debugTimelineTitle = await section
            .locator('.timeline-title')
            .first()
            .innerText()
            .catch(() => 'SELECTOR_NOT_FOUND');
        const debugDateSpan = await section
            .locator('.timeline-title .date')
            .innerText()
            .catch(() => 'SELECTOR_NOT_FOUND');
        log.info('Lu.ma DEBUG: timeline-title content', {
            sectionIndex: i,
            timelineTitleText: debugTimelineTitle,
            dateSpanText: debugDateSpan,
        });

        // Try specific .date span first, fall back to full .timeline-title text
        const dateText =
            (await section
                .locator('.timeline-title .date')
                .innerText()
                .catch(() => '')) ||
            (await section
                .locator('.timeline-title')
                .first()
                .innerText()
                .catch(() => ''));
        const isoDate = parseLumaDateHeader(dateText);

        const cards = section.locator('.card-wrapper');
        const cardCount = await cards.count();

        for (let j = 0; j < cardCount; j++) {
            const card = cards.nth(j);

            const title = sanitizeText(await card.locator('h3').innerText().catch(() => ''));
            const time = sanitizeText(await card.locator('.event-time').innerText().catch(() => ''));
            const locationText = sanitizeText(
                await card
                    .locator('.attribute:has(svg)')
                    .innerText()
                    .catch(() => ''),
            );
            const eventHref = await card
                .locator('a.event-link')
                .getAttribute('href')
                .catch(() => '');

            if (!title) continue;

            let eventUrl = '';
            if (eventHref) {
                eventUrl = eventHref.startsWith('http') ? eventHref : `https://lu.ma${eventHref}`;
            }

            events.push({
                type: 'event',
                title,
                start_date: isoDate,
                start_time: parseTimeString(time),
                end_date: isoDate,
                end_time: '',
                location: locationText,
                venue_name: extractVenueName(locationText),
                city: cityInfo.city,
                state: cityInfo.state,
                is_virtual: /\b(online|virtual)\b/i.test(locationText),
                url: eventUrl,
                source: 'lu.ma',
                scraped_at: new Date().toISOString(),
            });
        }
    }

    return events;
}

/**
 * Fallback: extract cards directly from .card-wrapper without date grouping.
 * Used when .timeline-section is missing (possible Lu.ma redesign).
 */
async function extractEventsFromCardsFallback(
    page: Page,
    cityInfo: { city: string; state: string },
): Promise<EventData[]> {
    const events: EventData[] = [];
    const cards = page.locator('.card-wrapper');
    const cardCount = await cards.count();

    for (let i = 0; i < cardCount; i++) {
        const card = cards.nth(i);

        const title = sanitizeText(await card.locator('h3').innerText().catch(() => ''));
        const time = sanitizeText(await card.locator('.event-time').innerText().catch(() => ''));
        const locationText = sanitizeText(
            await card
                .locator('.attribute:has(svg)')
                .innerText()
                .catch(() => ''),
        );
        const eventHref = await card
            .locator('a.event-link')
            .getAttribute('href')
            .catch(() => '');

        if (!title) continue;

        let eventUrl = '';
        if (eventHref) {
            eventUrl = eventHref.startsWith('http') ? eventHref : `https://lu.ma${eventHref}`;
        }

        events.push({
            type: 'event',
            title,
            start_date: '',
            start_time: parseTimeString(time),
            end_date: '',
            end_time: '',
            location: locationText,
            venue_name: extractVenueName(locationText),
            city: cityInfo.city,
            state: cityInfo.state,
            is_virtual: /\b(online|virtual)\b/i.test(locationText),
            url: eventUrl,
            source: 'lu.ma',
            scraped_at: new Date().toISOString(),
        });
    }

    return events;
}

export async function scrapeLumaEvents(input: ActorInput): Promise<number> {
    if (!input.lumaEventUrls || input.lumaEventUrls.length === 0) {
        log.info('Lu.ma: No event URLs configured, skipping');
        return 0;
    }

    let totalEvents = 0;

    const proxyConfig = input.useProxies
        ? await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] })
        : undefined;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxConcurrency: 2,
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: 2,
        async requestHandler({ page, request, log: crawlerLog }) {
            const cityInfo = request.userData.cityInfo as { city: string; state: string };
            const { url } = request;

            crawlerLog.info(`Lu.ma: Starting listing scrape of ${url}`, { city: cityInfo.city });

            // Wait for timeline sections to render
            const hasTimeline = await page
                .waitForSelector('.timeline-section', { timeout: 15000 })
                .then(() => true)
                .catch(() => false);

            let events: EventData[] = [];

            if (hasTimeline) {
                await scrollToLoadAllEvents(page);
                events = await extractEventsFromListingPage(page, cityInfo);
                crawlerLog.info(`Lu.ma: Extracted ${events.length} events from listing page ${url}`);

                if (events.length === 0) {
                    crawlerLog.warning(
                        `Lu.ma: .timeline-section found but 0 events extracted at ${url} — .card-wrapper or h3 selectors may need updating`,
                    );
                }
            } else {
                // Fallback: try .card-wrapper directly
                crawlerLog.warning(
                    `Lu.ma: No .timeline-section found on ${url}, trying .card-wrapper fallback`,
                );
                const hasCards = await page.locator('.card-wrapper').count();

                if (hasCards > 0) {
                    await scrollToLoadAllEvents(page);
                    events = await extractEventsFromCardsFallback(page, cityInfo);
                    crawlerLog.info(
                        `Lu.ma: Fallback extracted ${events.length} events from ${url} (no date grouping)`,
                    );
                } else {
                    crawlerLog.error(
                        `Lu.ma: Neither .timeline-section nor .card-wrapper found on ${url} — Lu.ma page structure may have changed`,
                    );
                    return;
                }
            }

            if (events.length === 0) return;

            // Deduplicate and push directly to dataset
            const unique = deduplicateByUrl(events);
            for (const event of unique) {
                await Actor.pushData(event);
            }
            totalEvents += unique.length;
        },
        async failedRequestHandler({ request, log: crawlerLog }) {
            crawlerLog.error(`Lu.ma: Listing page failed after retries`, { url: request.url });
        },
    });

    const listingRequests = input.lumaEventUrls
        .filter((url) => url.startsWith('https://lu.ma/'))
        .map((url) => ({
            url,
            userData: { cityInfo: inferCityFromUrl(url) },
        }));

    await crawler.addRequests(listingRequests);
    await crawler.run();

    log.info('Lu.ma: Scraping complete', { totalEvents });

    if (totalEvents === 0) {
        log.warning(
            'Lu.ma: 0 events found across all URLs — check if Lu.ma page structure changed or URLs are correct',
        );
    }

    return totalEvents;
}
