/**
 * TrustData Tracking Core - Constants
 * Shared between JS SDK and Shopify Pixel
 */

export const VERSION = '0.4.0';
export const LIB_NAME_JS = 'trustdata_js';
export const LIB_NAME_SHOPIFY = 'shopify_pixel';

// Server URLs
export const DEFAULT_SERVER_URL = 'https://t.trustdata.tech';
export const TRUSTDATA_API_URL = 'https://app.trustdata.tech';

// Storage keys
export const STORAGE_KEYS = {
    VISITOR_ID: '_trdt_vid',
    USER_ID: '_trdt_uid',
    ADBLOCK: '_trdt_adblock',
};

// UTM params that indicate marketing touchpoints. Kept in BOTH consent modes:
// they describe the ad/campaign, not the person, and travel in the request URL
// (not device storage), so they do not require analytics consent.
export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

// Cross-site click identifiers. Masked only when analytics consent is absent —
// with consent they are kept for attribution.
export const PERSONAL_DATA_PARAMS = [
    'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid',
    'msclkid', 'twclid', 'li_fat_id', 'ttclid', 'rdt_cid', 'epik',
    'igshid', 'yclid', 's_kwcid', 'mc_eid', '_branch_match_id', 'vero_id',
];

// Generic personal-data params that may carry PII in the URL regardless of
// consent (a misconfigured site can put an email/token in any query string).
// Masked in BOTH modes. Matched case-insensitively. Kept deliberately tight to
// avoid masking legitimate analytics dimensions.
export const PII_PARAMS = [
    'email', 'e-mail', 'mail', 'phone', 'tel', 'mobile',
    'token', 'access_token', 'id_token', 'auth_token', 'auth', 'jwt',
    'password', 'pwd', 'passwd', 'secret', 'apikey', 'api_key', 'otp', 'ssn',
];

// AdBlock test endpoints
export const ADBLOCK_ENDPOINTS = {
    google_analytics: 'https://www.google-analytics.com/g/collect',
    google_tag_manager: 'https://www.googletagmanager.com/gtm.js',
    google_ads: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
    facebook: 'https://www.facebook.com/tr',
    tiktok: 'https://analytics.tiktok.com/api/v2/pixel',
    microsoft: 'https://bat.bing.com/action/0',
};

// Event name mapping: Shopify standard events -> TrustData (GA4-style)
// https://shopify.dev/docs/api/web-pixels-api/standard-events
export const SHOPIFY_EVENT_MAP = {
    page_viewed: 'page_view',
    product_viewed: 'view_item',
    product_added_to_cart: 'add_to_cart',
    product_removed_from_cart: 'remove_from_cart',
    cart_viewed: 'view_cart',
    checkout_started: 'begin_checkout',
    checkout_contact_info_submitted: 'add_contact_info',
    checkout_address_info_submitted: 'add_shipping_info',
    checkout_shipping_info_submitted: 'add_shipping_info',
    payment_info_submitted: 'add_payment_info',
    checkout_completed: 'purchase',
    collection_viewed: 'view_item_list',
    search_submitted: 'search',
    // Skipped: alert_displayed, ui_extension_errored (system events)
};

