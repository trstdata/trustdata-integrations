/**
 * TrustData Tracking Core
 * Shared utilities for JS SDK and Shopify Pixel
 */

// Constants
export {
    VERSION,
    LIB_NAME_JS,
    LIB_NAME_SHOPIFY,
    DEFAULT_SERVER_URL,
    TRUSTDATA_API_URL,
    STORAGE_KEYS,
    UTM_PARAMS,
    PERSONAL_DATA_PARAMS,
    PII_PARAMS,
    ADBLOCK_ENDPOINTS,
    SHOPIFY_EVENT_MAP,
} from './constants.js';

// URL utilities
export {
    maskUrl,
    sanitizePageUrl,
    sanitizeReferrer,
    hasMarketingParams,
    isExternalReferrer,
} from './url.js';

// Payload utilities
export {
    cleanPayload,
    generateId,
    formatAdBlockData,
    getTimestamp,
    truncate,
} from './payload.js';

// User data utilities
export { buildUserData, hashSHA256 } from './user-data.js';
