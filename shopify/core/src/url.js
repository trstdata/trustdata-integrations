/**
 * TrustData Tracking Core - URL Utilities
 * Shared between JS SDK and Shopify Pixel
 */

import { PERSONAL_DATA_PARAMS, UTM_PARAMS, PII_PARAMS } from "./constants.js";

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
    const targets = new Set(params.map((p) => p.toLowerCase()));
    for (const key of [...u.searchParams.keys()]) {
      if (targets.has(key.toLowerCase())) {
        u.searchParams.set(key, "[MASKED]");
      }
    }

    // Credentials are the strongest PII a URL can carry and they are not
    // query params, so the loop above never sees them.
    u.username = "";
    u.password = "";

    // The fragment carries the same params in OAuth implicit-flow and
    // magic-link callbacks, where the token never reaches the query string
    // at all. Masking searchParams alone sent those through intact.
    if (u.hash.length > 1) {
      const raw = u.hash.slice(1);
      const q = raw.indexOf("?");
      // "#/route?token=x" keeps its route. "#token=x" is all params.
      const prefix = q === -1 ? "" : raw.slice(0, q + 1);
      const query = q === -1 ? raw : raw.slice(q + 1);
      if (query.includes("=")) {
        const fragment = new URLSearchParams(query);
        let masked = false;
        for (const key of [...fragment.keys()]) {
          if (targets.has(key.toLowerCase())) {
            fragment.set(key, "[MASKED]");
            masked = true;
          }
        }
        // Only rewrite when something was masked. URLSearchParams
        // re-encodes, and a fragment we did not need to touch should
        // come back unchanged.
        if (masked) u.hash = `#${prefix}${fragment.toString()}`;
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
  const params = consented
    ? PII_PARAMS
    : [...PII_PARAMS, ...PERSONAL_DATA_PARAMS];
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
    // Case-insensitive on the param name, like maskUrl. When these two
    // disagreed, "?UTM_SOURCE=newsletter" was masked as marketing by one
    // and recorded no touchpoint by the other.
    const keys = new Set(
      [...new URL(url).searchParams.keys()].map((k) => k.toLowerCase()),
    );
    return MARKETING_PARAMS.some((p) => keys.has(p.toLowerCase()));
  } catch {
    return false;
  }
}

/**
 * Is `host` the domain itself, or a subdomain of it?
 * @param {string} host lowercased hostname, www stripped
 * @param {string} domain entry from an ignore list, as configured
 * @returns {boolean}
 */
function isSameSite(host, domain) {
  const d = String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!d) return false;
  return host === d || host.endsWith(`.${d}`);
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
    const refHost = new URL(referrer).hostname.replace(/^www\./, "");
    const curHost = currentHost.replace(/^www\./, "");

    if (refHost === curHost) return false;
    // Match the domain or a subdomain of it, never a substring. `includes`
    // let "shop.com.attacker.net" pass as first-party for an ignore entry
    // of "shop.com", and an entry as short as "co" suppressed almost every
    // referrer. An empty entry suppressed all of them.
    if (ignoreList.some((domain) => isSameSite(refHost, domain))) return false;

    return true;
  } catch {
    return false;
  }
}
