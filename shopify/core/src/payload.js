/**
 * TrustData Tracking Core - Payload Utilities
 * Shared between JS SDK and Shopify Pixel
 */

/**
 * Clean null/undefined values from object
 * @param {Object} obj
 * @returns {Object}
 */
export function cleanPayload(obj) {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value != null) {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

/**
 * Generate UUID v4
 * @returns {string}
 */
export function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Format AdBlock result for payload
 * @param {Object|null} result
 * @returns {{adblock_detected: boolean|null, adblock_platforms: string|null}}
 */
export function formatAdBlockData(result) {
    if (!result) {
        return {
            adblock_detected: null,
            adblock_platforms: null,
        };
    }

    const blockedPlatforms = Object.entries(result.platforms)
        .filter(([_, blocked]) => blocked)
        .map(([platform]) => platform);

    return {
        adblock_detected: result.detected,
        adblock_platforms: blockedPlatforms.length ? blockedPlatforms.join(',') : null,
    };
}

/**
 * Get current timestamp in seconds
 * @returns {number}
 */
export function getTimestamp() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Truncate string to max length
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
}
