import { Actor, log } from 'apify';

import type { ActorInput, EventData } from '../types.js';

export async function scrapeMeetupEvents(input: ActorInput): Promise<number> {
    if (!input.meetupCities || input.meetupCities.length === 0) {
        return 0;
    }

    let totalEventsAdded = 0;
    const startDateRange = new Date().toISOString().split('T')[0];

    for (const cityEntry of input.meetupCities) {
        const city = toTitleCase(cityEntry.city);

        try {
            log.info('Meetup: Calling scraper actor', {
                city,
                state: cityEntry.state,
                keywords: input.meetupKeywords,
                maxResults: input.meetupMaxResultsPerCity,
                startDateRange,
            });

            const run = await Actor.call('filip_cicvarek/meetup-scraper', {
                city,
                state: cityEntry.state || '',
                country: 'US',
                searchKeyword: input.meetupKeywords || '',
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

                const eventData: EventData = {
                    type: 'event',
                    title: item.title || item.name || item.eventName || 'Untitled Event',
                    url,
                    start_date: item.date || item.eventDate || item.startDate,
                    end_date: item.endDate,
                    start_time: item.time || item.eventTime || item.startTime,
                    end_time: item.endTime,
                    location,
                    venue_name: item.venueName || item.venue?.name || item.address,
                    city: item.city || item.venue?.city || cityEntry.city,
                    state: item.state || item.venue?.state || cityEntry.state,
                    description: item.description || item.snippet || item.eventDescription,
                    is_virtual: Boolean(item.isVirtual || item.is_virtual || item.isOnline || item.eventType === 'ONLINE'),
                    source: 'meetup.com',
                    scraped_at: new Date().toISOString(),
                };

                await Actor.pushData(eventData);
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
