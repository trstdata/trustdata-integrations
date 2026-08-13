/**
 * TrustData Tracking Core - URL Utilities
 * Shared between JS SDK and Shopify Pixel
 */

import { PERSONAL_DATA_PARAMS, UTM_PARAMS, PII_PARAMS } from './constants.js';

const MARKETING_PARAMS = [...UTM_PARAMS, ...PERSONAL_DATA_PARAMS];

/**
 * Mask specified params in a URL (case-insensitive on param name).
 * @param {string} url
 * @param {string[]} [params]
 * @returns {string}
 */
export function maskUrl(url, params = PERSONAL_DATA_PARAMS) {
    if (!url || !params.length) return url;
    try {
        const u = new URL(url);
        const targets = new Set(params.map(p => p.toLowerCase()));
        for (const key of [...u.searchParams.keys()]) {
            if (targets.has(key.toLowerCase())) {
                u.searchParams.set(key, '[MASKED]');
            }
        }
        return u.toString();
    } catch {
        return url;
    }
}

/**
 * Sanitize the page URL for sending.
 * - With analytics consent: keep click IDs (attribution), mask only generic PII.
 * - Without consent: mask click IDs AND generic PII. UTMs are kept in both modes.
 * @param {string} url
 * @param {boolean} consented
 * @returns {string}
 */
export function sanitizePageUrl(url, consented) {
    const params = consented ? PII_PARAMS : [...PII_PARAMS, ...PERSONAL_DATA_PARAMS];
    return maskUrl(url, params);
}

/**
 * Sanitize the referrer for sending.
 * - With analytics consent: mask generic PII params, keep the rest.
 * - Without consent: reduce to origin (scheme + host) only — CNIL host-only rule.
 * @param {string} referrer
 * @param {boolean} consented
 * @returns {string|null}
 */
export function sanitizeReferrer(referrer, consented) {
    if (!referrer) return null;
    if (consented) return maskUrl(referrer, PII_PARAMS);
    try {
        return new URL(referrer).origin;
    } catch {
        return null;
    }
}

/**
 * Check if URL has marketing parameters (UTM or click IDs)
 * @param {string} url
 * @returns {boolean}
 */
export function hasMarketingParams(url) {
    if (!url) return false;
    try {
        const params = new URL(url).searchParams;
        return MARKETING_PARAMS.some(p => params.has(p));
    } catch {
        return false;
    }
}

/**
 * Check if referrer is external (different domain)
 * @param {string} referrer
 * @param {string} currentHost
 * @param {string[]} [ignoreList]
 * @returns {boolean}
 */
export function isExternalReferrer(referrer, currentHost, ignoreList = []) {
    if (!referrer) return false;
    try {
        const refHost = new URL(referrer).hostname.replace(/^www\./, '');
        const curHost = currentHost.replace(/^www\./, '');

        if (refHost === curHost) return false;
        if (ignoreList.some(domain => refHost.includes(domain))) return false;

        return true;
    } catch {
        return false;
    }
}
