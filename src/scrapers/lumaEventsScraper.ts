import { Actor, log } from 'apify';

import { LUMA_PLACE_IDS } from '../config.js';
import type { ActorInput, EventData } from '../types.js';

/** Response shape from the Lu.ma Discover API */
interface LumaApiEntry {
    event: {
        api_id: string;
        name: string;
        start_at: string;
        end_at: string;
        timezone: string;
        url: string; // slug, e.g. "fjhahpqh"
        location_type: string;
        geo_address_info?: {
            city?: string;
            region?: string;
            address?: string;
            full_address?: string;
        };
    };
    hosts?: { name?: string }[];
    guest_count?: number;
    ticket_info?: {
        is_free?: boolean;
    };
}

/**
 * Extract the city slug from a Lu.ma URL.
 * e.g. "https://lu.ma/austin" → "austin", "https://lu.ma/austin-ai" → "austin-ai"
 */
function extractSlugFromUrl(url: string): string {
    try {
        return new URL(url).pathname.replace(/^\//, '').split('/')[0].toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Fetch events from the Lu.ma Discover API for a given city.
 * This is an unauthenticated public endpoint — no keys, cookies, or proxies needed.
 */
async function fetchLumaDiscoverEvents(discoverPlaceApiId: string, paginationLimit = 25): Promise<LumaApiEntry[]> {
    const url = `https://api2.luma.com/discover/get-paginated-events?discover_place_api_id=${discoverPlaceApiId}&pagination_limit=${paginationLimit}`;

    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`Lu.ma API returned ${response.status}: ${response.statusText}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await response.json()) as any;
    return (data.entries ?? []) as LumaApiEntry[];
}

export async function scrapeLumaEvents(input: ActorInput): Promise<number> {
    if (!input.lumaEventUrls || input.lumaEventUrls.length === 0) {
        log.info('Lu.ma: No event URLs configured, skipping');
        return 0;
    }

    let totalEvents = 0;

    for (const lumaUrl of input.lumaEventUrls) {
        const slug = extractSlugFromUrl(lumaUrl);
        const placeId = LUMA_PLACE_IDS[slug];

        if (!placeId) {
            log.warning(`Lu.ma: No discover_place_api_id mapped for slug "${slug}" (from ${lumaUrl}), skipping`);
            continue;
        }

        try {
            log.info(`Lu.ma: Fetching events via API for "${slug}"...`, { placeId });
            const entries = await fetchLumaDiscoverEvents(placeId);
            log.info(`Lu.ma: API returned ${entries.length} events for "${slug}"`);

            for (const entry of entries) {
                const ev = entry.event;
                const geo = ev.geo_address_info;
                const isVirtual = ev.location_type === 'online';

                const eventData: EventData = {
                    type: 'event',
                    source: 'luma',
                    title: ev.name,
                    url: `https://lu.ma/${ev.url}`,
                    start_date: ev.start_at,
                    end_date: ev.end_at,
                    timezone: ev.timezone,
                    venue_name: geo?.address ?? undefined,
                    location: geo?.full_address ?? undefined,
                    city: geo?.city ?? undefined,
                    region: geo?.region ?? undefined,
                    host_name: entry.hosts?.[0]?.name ?? undefined,
                    guest_count: entry.guest_count ?? 0,
                    is_free: entry.ticket_info?.is_free ?? true,
                    is_virtual: isVirtual,
                    scraped_at: new Date().toISOString(),
                };

                await Actor.pushData(eventData);
                totalEvents++;
            }
        } catch (error) {
            log.error(`Lu.ma: API fetch failed for "${slug}"`, { error: (error as Error).message });
        }

        // Small courtesy delay between city requests
        if (input.lumaEventUrls.indexOf(lumaUrl) < input.lumaEventUrls.length - 1) {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 500);
            });
        }
    }

    log.info('Lu.ma: Scraping complete', { totalEvents });

    if (totalEvents === 0) {
        log.warning('Lu.ma: 0 events found — check if place IDs have changed or API is down');
    }

    return totalEvents;
}
