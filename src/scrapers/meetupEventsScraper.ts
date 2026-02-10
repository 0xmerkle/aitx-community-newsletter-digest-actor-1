import { Actor, log } from 'apify';

import type { ActorInput, EventData } from '../types.js';

export async function scrapeMeetupEvents(input: ActorInput): Promise<number> {
    if (!input.meetupCities || input.meetupCities.length === 0) {
        return 0;
    }

    let totalEventsAdded = 0;

    for (const cityEntry of input.meetupCities) {
        try {
            log.info('Meetup: Calling scraper actor', {
                city: cityEntry.city,
                state: cityEntry.state,
                keywords: input.meetupKeywords,
                maxResults: input.meetupMaxResultsPerCity,
            });

            const run = await Actor.call('filip_cicvarek/meetup-scraper', {
                city: cityEntry.city,
                state: cityEntry.state || '',
                country: 'us',
                searchKeyword: input.meetupKeywords || '',
                maxResults: input.meetupMaxResultsPerCity || 10,
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

            // Get items from the actor's dataset
            const dataset = await Actor.openDataset(run.defaultDatasetId);
            const { items } = await dataset.getData();

            log.info(`Meetup: External actor returned ${items.length} events for ${cityEntry.city}`);

            let eventsAdded = 0;

            // Transform and filter events
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const item of items as any[]) {
                // Skip events without URLs
                const url = item.url || item.link;
                if (!url) {
                    log.debug('Skipping event without URL', { title: item.title || item.name });
                    continue;
                }

                // Skip online/virtual events (in-person only per PRD)
                const location = (item.location || item.venue || '').toLowerCase();
                if (location.includes('online') || location.includes('virtual')) {
                    log.debug('Skipping online event', { title: item.title || item.name });
                    continue;
                }

                const eventData: EventData = {
                    type: 'event',
                    title: item.title || item.name || 'Untitled Event',
                    url,
                    start_date: item.date || item.eventDate || item.startDate,
                    end_date: item.endDate,
                    start_time: item.time || item.eventTime || item.startTime,
                    end_time: item.endTime,
                    location: item.location || item.venue,
                    venue_name: item.venueName || item.venue,
                    city: item.city || cityEntry.city,
                    state: item.state || cityEntry.state,
                    description: item.description || item.snippet,
                    is_virtual: Boolean(item.isVirtual || item.is_virtual || item.isOnline),
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
