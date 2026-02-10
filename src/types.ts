export interface ActorInput {
    rssFeedUrl: string;
    additionalUrls?: { url: string }[];
    lumaEventUrls?: string[];
    meetupCities?: { city: string; state: string }[];
    meetupKeywords?: string;
    meetupMaxResultsPerCity?: number;
    maxArticles?: number;
    useProxies?: boolean;
}

export interface ArticleData {
    type: 'article';
    headline: string;
    url: string;
    text_content: string;
    description: string;
    published_date?: string;
    source_name: string;
    scraped_at: string;
}

export interface EventData {
    type: 'event';
    title: string;
    url: string;
    description?: string;
    start_date?: string;
    start_time?: string;
    end_date?: string;
    end_time?: string;
    location?: string;
    venue_name?: string;
    city?: string;
    state?: string;
    is_virtual?: boolean;
    source: string;
    scraped_at: string;
}
