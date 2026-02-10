import { MAX_TEXT_LENGTH, TEXT_SELECTORS } from '../config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractArticleText($: any): string {
    // Remove noise elements
    $(
        'script, style, nav, header, footer, aside, .comments, .advertisement, [role="navigation"], [role="banner"], [role="complementary"]',
    ).remove();

    // Try semantic selectors from config
    for (const selector of TEXT_SELECTORS) {
        const text = $(selector).text().trim();
        if (text.length > 200) {
            return cleanText(text);
        }
    }

    // Fallback to paragraphs
    const paragraphs: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $('p').each((_: any, elem: any) => {
        const text = $(elem).text().trim();
        if (text.length > 20) {
            paragraphs.push(text);
        }
    });

    if (paragraphs.length > 0) {
        return cleanText(paragraphs.join('\n\n'));
    }

    // Last resort: body
    return cleanText($('body').text());
}

function cleanText(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n\s*\n+/g, '\n\n')
        .trim()
        .slice(0, MAX_TEXT_LENGTH);
}
