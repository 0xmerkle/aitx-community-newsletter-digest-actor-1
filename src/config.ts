// Default values
export const DEFAULT_LUMA_EVENT_URLS = ['https://lu.ma/austin', 'https://lu.ma/houston'];
export const DEFAULT_MEETUP_CITIES = [
    { city: 'austin', state: 'tx' },
    { city: 'houston', state: 'tx' },
];
export const DEFAULT_MEETUP_KEYWORDS = 'AI';
export const DEFAULT_MEETUP_MAX_RESULTS_PER_CITY = 15;
export const DEFAULT_MAX_ARTICLES = 50;
export const DEFAULT_USE_PROXIES = true;

// Timeouts
export const HTTP_TIMEOUT = 60000;
export const BROWSER_TIMEOUT = 90000;
export const BROWSER_NAVIGATION_TIMEOUT = 90;

// Concurrency
export const HTTP_CONCURRENCY = 10;
export const BROWSER_CONCURRENCY = 1;

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
