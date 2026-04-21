/**
 * TrustData Shopify Pixel - Utilities
 * Re-exports from core + Shopify-specific utilities
 */

import { VERSION, LIB_NAME, PERSONAL_DATA_PARAMS } from './constants';
import type { ShopifyContext } from './types';

// Re-export from core
export {
    maskUrl,
    cleanPayload,
    getTimestamp,
    truncate,
    formatAdBlockData,
    buildUserData
} from '@trustdata/tracking-core';

// Import for internal use
import { maskUrl, truncate, getTimestamp } from '@trustdata/tracking-core';

/**
 * Get common event properties from Shopify context
 * Matches JS SDK structure for server compatibility
 */
export function getEventProperties(
    context: ShopifyContext,
    maskPersonalData: boolean = false
): Record<string, unknown> {
    const doc = context?.document;
    const nav = context?.navigator;
    const win = context?.window;
    const screen = win?.screen;

    // User-Agent with length limit
    const rawUserAgent = nav?.userAgent ? truncate(nav.userAgent, 1000) : undefined;

    // Timezone
    let timezone: string | undefined;
    let timezoneOffset: number | undefined;
    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        timezoneOffset = new Date().getTimezoneOffset();
    } catch {
        // May not be available in sandbox
    }

    // Page location (masked if enabled)
    let pageLocation = doc?.location?.href;
    if (pageLocation && maskPersonalData) {
        pageLocation = maskUrl(pageLocation, PERSONAL_DATA_PARAMS as unknown as string[]);
    }

    return {
        lib: LIB_NAME,
        lib_version: VERSION,
        event_time: getTimestamp(),
        page_location: pageLocation,
        page_referrer: doc?.referrer || undefined,
        page_title: doc?.title,
        raw_user_agent: rawUserAgent,
        browser_language: nav?.language,
        timezone,
        timezone_offset: timezoneOffset,
        screen_resolution: screen ? `${screen.width}x${screen.height}` : undefined,
        viewport_resolution: win ? `${win.innerWidth}x${win.innerHeight}` : undefined,
    };
}
