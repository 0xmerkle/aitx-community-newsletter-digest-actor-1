import {
    DEFAULT_LUMA_EVENT_URLS,
    DEFAULT_MAX_ARTICLES,
    DEFAULT_MEETUP_CITIES,
    DEFAULT_MEETUP_KEYWORDS,
    DEFAULT_MEETUP_MAX_RESULTS_PER_CITY,
    DEFAULT_USE_PROXIES,
} from '../config.js';
import type { ActorInput } from '../types.js';

export function validateInput(input: unknown): ActorInput {
    if (!input || typeof input !== 'object') {
        throw new Error('Input must be an object');
    }

    const rawInput = input as Record<string, unknown>;

    // Required field
    if (!rawInput.rssFeedUrl || typeof rawInput.rssFeedUrl !== 'string') {
        throw new Error('rssFeedUrl is required and must be a string');
    }

    // Build validated input with defaults
    const validatedInput: ActorInput = {
        rssFeedUrl: rawInput.rssFeedUrl,
        additionalUrls: Array.isArray(rawInput.additionalUrls) ? rawInput.additionalUrls : [],
        lumaEventUrls: Array.isArray(rawInput.lumaEventUrls) ? rawInput.lumaEventUrls : DEFAULT_LUMA_EVENT_URLS,
        meetupCities: Array.isArray(rawInput.meetupCities) ? rawInput.meetupCities : DEFAULT_MEETUP_CITIES,
        meetupKeywords:
            typeof rawInput.meetupKeywords === 'string' ? rawInput.meetupKeywords : DEFAULT_MEETUP_KEYWORDS,
        meetupMaxResultsPerCity:
            typeof rawInput.meetupMaxResultsPerCity === 'number'
                ? Math.max(1, Math.min(100, rawInput.meetupMaxResultsPerCity))
                : DEFAULT_MEETUP_MAX_RESULTS_PER_CITY,
        maxArticles:
            typeof rawInput.maxArticles === 'number' ? Math.max(0, rawInput.maxArticles) : DEFAULT_MAX_ARTICLES,
        useProxies: typeof rawInput.useProxies === 'boolean' ? rawInput.useProxies : DEFAULT_USE_PROXIES,
    };

    return validatedInput;
}
