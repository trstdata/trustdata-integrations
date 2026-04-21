import { ADBLOCK_ENDPOINTS, STORAGE_KEYS } from './constants';
import type { AdBlockResult, ShopifyBrowser } from './types';

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Test if a URL is blocked by an ad blocker
 * Fast failures (<100ms) indicate blocking
 */
async function testUrl(url: string): Promise<boolean> {
    const start = Date.now();
    try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 2000);

        await fetch(url + '?_t=' + start, {
            method: 'HEAD',
            mode: 'no-cors',
            credentials: 'omit',
            signal: ctrl.signal,
        });

        clearTimeout(timeout);
        return false;
    } catch {
        // Fast failure (<100ms) = blocked
        return Date.now() - start < 100;
    }
}

/**
 * Run ad blocker detection for all platforms
 */
export async function detectAdBlock(browser: ShopifyBrowser): Promise<AdBlockResult> {
    // Check cache first
    try {
        const cached = await browser.localStorage.getItem(STORAGE_KEYS.ADBLOCK);
        if (cached) {
            const parsed: AdBlockResult = JSON.parse(cached);
            if (Date.now() - parsed.checkedAt < CACHE_TTL) {
                return parsed;
            }
        }
    } catch {
        // Ignore cache errors
    }

    // Run detection
    const platforms: Record<string, boolean> = {};
    let anyBlocked = false;

    const tests = Object.entries(ADBLOCK_ENDPOINTS).map(async ([name, url]) => {
        const blocked = await testUrl(url);
        platforms[name] = blocked;
        if (blocked) anyBlocked = true;
    });

    await Promise.all(tests);

    const result: AdBlockResult = {
        detected: anyBlocked,
        platforms,
        checkedAt: Date.now(),
    };

    // Cache result
    try {
        await browser.localStorage.setItem(STORAGE_KEYS.ADBLOCK, JSON.stringify(result));
    } catch {
        // Ignore cache errors
    }

    return result;
}

/**
 * Format adblock data for payload
 */
export function formatAdBlockData(result: AdBlockResult): {
    adblock_detected: boolean | null;
    adblock_platforms: string | null;
} {
    const blocked = Object.entries(result.platforms)
        .filter(([, b]) => b)
        .map(([name]) => name);

    return {
        adblock_detected: result.detected,
        adblock_platforms: blocked.length ? blocked.join(',') : null,
    };
}
