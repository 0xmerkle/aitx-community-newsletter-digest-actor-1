export function parseDate(dateString: string | undefined): string | undefined {
    if (!dateString) {
        return undefined;
    }

    try {
        const date = new Date(dateString);

        // Check if date is valid
        if (Number.isNaN(date.getTime())) {
            return undefined;
        }

        return date.toISOString();
    } catch {
        return undefined;
    }
}
