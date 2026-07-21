import { Actor, log } from 'apify';

import type { ActorInput, EventData } from '../types.js';

export async function scrapeMeetupEvents(input: ActorInput): Promise<number> {
    if (!input.meetupCities || input.meetupCities.length === 0) {
        return 0;
    }

    let totalEventsAdded = 0;
    const startDateRange = new Date().toISOString().split('T')[0];

    // Multiple keywords widen the pool so the synthesizer always has enough
    // candidates to guarantee its minimum event count after filtering.
    const keywords = (input.meetupKeywords || 'AI')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    const seenEventUrls = new Set<string>();

    const searches = input.meetupCities.flatMap((cityEntry) => keywords.map((keyword) => ({ cityEntry, keyword })));

    for (const { cityEntry, keyword } of searches) {
        const city = toTitleCase(cityEntry.city);

        try {
            log.info('Meetup: Calling scraper actor', {
                city,
                state: cityEntry.state,
                keyword,
                maxResults: input.meetupMaxResultsPerCity,
                startDateRange,
            });

            const run = await Actor.call('filip_cicvarek/meetup-scraper', {
                city,
                state: cityEntry.state || '',
                country: 'us',
                searchKeyword: keyword,
                eventType: 'PHYSICAL',
                maxResults: input.meetupMaxResultsPerCity || 10,
                startDateRange,
            });

            if (!run) {
                log.error('Meetup: External actor returned no run object', { city: cityEntry.city });
                continue;
            }

            if (run.status !== 'SUCCEEDED') {
                log.error(`Meetup: External actor failed with status: ${run.status}`, { city: cityEntry.city });
                continue;
            }

            if (!run.defaultDatasetId) {
                log.warning('Meetup: External actor did not return a dataset', { city: cityEntry.city });
                continue;
            }

            // The Meetup scraper runs in Apify cloud. When this actor runs locally,
            // forceCloud avoids opening an empty local dataset with the same ID.
            const dataset = await Actor.openDataset(run.defaultDatasetId, { forceCloud: true });
            const { items } = await dataset.getData();

            log.info(`Meetup: External actor returned ${items.length} events for ${cityEntry.city}`, {
                datasetId: run.defaultDatasetId,
            });

            let eventsAdded = 0;

            // Transform and filter events
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const item of items as any[]) {
                // Skip events without URLs
                const url = item.url || item.link || item.eventUrl;
                if (!url) {
                    log.debug('Skipping event without URL', { title: item.title || item.name || item.eventName });
                    continue;
                }

                // Same event can come back for multiple keywords/cities
                if (seenEventUrls.has(url)) {
                    log.debug('Skipping duplicate event', { url });
                    continue;
                }

                // Skip online/virtual events (in-person only per PRD)
                const location = getLocation(item).toLowerCase();
                if (location.includes('online') || location.includes('virtual')) {
                    log.debug('Skipping online event', { title: item.title || item.name || item.eventName });
                    continue;
                }

                if (item.eventType && item.eventType !== 'PHYSICAL') {
                    log.debug('Skipping non-physical Meetup event', {
                        title: item.title || item.name || item.eventName,
                        eventType: item.eventType,
                    });
                    continue;
                }

                // The scraper returns ISO datetimes with offset (e.g. "2026-07-29T18:00:00-05:00")
                // in `date`/`startDateTime`/`endDateTime` plus an IANA `timezone`.
                const eventData: EventData = {
                    type: 'event',
                    title: item.title || item.name || item.eventName || 'Untitled Event',
                    url,
                    start_date: item.date || item.startDateTime || item.eventDate || item.startDate,
                    end_date: item.endDateTime || item.endDate,
                    start_time: item.time || item.eventTime || item.startTime,
                    end_time: item.endTime,
                    timezone: item.timezone,
                    location,
                    venue_name: item.venue?.name || item.venueName || item.address,
                    city: item.city || item.venue?.city || cityEntry.city,
                    state: item.state || item.venue?.state || cityEntry.state,
                    description: item.description || item.snippet || item.eventDescription,
                    is_virtual: Boolean(item.isVirtual || item.is_virtual || item.isOnline || item.eventType === 'ONLINE'),
                    categories: Array.isArray(item.topics)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ? item.topics.map((t: any) => t?.name).filter(Boolean)
                        : undefined,
                    source: 'meetup.com',
                    scraped_at: new Date().toISOString(),
                };

                await Actor.pushData(eventData);
                seenEventUrls.add(url);
                eventsAdded++;
            }

            log.info('Meetup: Events processed', {
                city: cityEntry.city,
                retrieved: items.length,
                added: eventsAdded,
                filtered: items.length - eventsAdded,
            });

            if (eventsAdded === 0 && items.length > 0) {
                log.warning(
                    'Meetup: All events were filtered out — check field mapping or filter criteria',
                    { city: cityEntry.city },
                );
            }

            totalEventsAdded += eventsAdded;
        } catch (error) {
            log.error(`Meetup: Actor call failed for ${cityEntry.city}: ${(error as Error).message}`, { error });
        }
    }

    log.info('Meetup: All cities complete', { totalEventsAdded });
    return totalEventsAdded;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLocation(item: any): string {
    if (typeof item.location === 'string') return item.location;
    if (typeof item.address === 'string') return item.address;
    if (typeof item.venue === 'string') return item.venue;
    if (item.venue?.address && item.venue?.name) return `${item.venue.name}, ${item.venue.address}`;
    if (item.venue?.address) return item.venue.address;
    if (item.venue?.name) return item.venue.name;
    return '';
}

function toTitleCase(value: string): string {
    return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
