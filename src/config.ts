// Default values
export const DEFAULT_LUMA_EVENT_URLS = ['https://lu.ma/austin', 'https://lu.ma/houston'];
export const DEFAULT_MEETUP_CITIES = [
    { city: 'austin', state: 'tx' },
    { city: 'houston', state: 'tx' },
];
export const DEFAULT_MEETUP_KEYWORDS = 'AI, machine learning, data science';
export const DEFAULT_MEETUP_MAX_RESULTS_PER_CITY = 15;
export const DEFAULT_MAX_ARTICLES = 50;
export const DEFAULT_USE_PROXIES = true;

// Lu.ma Discover API place IDs
export const LUMA_PLACE_IDS: Record<string, string> = {
    austin: 'discplace-0tPy8KGz3xMycnt',
    'austin-ai': 'discplace-0tPy8KGz3xMycnt',
    houston: 'discplace-aQeJaEtqg3shHZ1',
    'houston-ai': 'discplace-aQeJaEtqg3shHZ1',
};

// How many upcoming events to pull per Lu.ma place. Over-fetch on purpose:
// the synthesizer filters aggressively and needs enough candidates to
// guarantee its minimum event count.
export const LUMA_PAGINATION_LIMIT = 50;

// Timeouts
export const HTTP_TIMEOUT = 60000;

// Concurrency
export const HTTP_CONCURRENCY = 10;

// Text selectors (ordered by priority)
export const TEXT_SELECTORS = [
    'article',
    '[role="article"]',
    '.article-content',
    'main',
    '.post-content',
    '.entry-content',
    '[itemprop="articleBody"]',
];

// Max text length
export const MAX_TEXT_LENGTH = 50000;
