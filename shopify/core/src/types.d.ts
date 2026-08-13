/**
 * TrustData Tracking Core - TypeScript Definitions
 */

// Constants
export const VERSION: string;
export const LIB_NAME_JS: string;
export const LIB_NAME_SHOPIFY: string;
export const DEFAULT_SERVER_URL: string;
export const TRUSTDATA_API_URL: string;
export const STORAGE_KEYS: {
    VISITOR_ID: string;
    USER_ID: string;
    ADBLOCK: string;
};
export const UTM_PARAMS: string[];
export const PERSONAL_DATA_PARAMS: string[];
export const PII_PARAMS: string[];
export const ADBLOCK_ENDPOINTS: Record<string, string>;
export const SHOPIFY_EVENT_MAP: Record<string, string>;

// URL utilities
export function maskUrl(url: string, params?: string[]): string;
export function hasMarketingParams(url: string): boolean;
export function isExternalReferrer(referrer: string, currentHost: string, ignoreList?: string[]): boolean;
export function sanitizePageUrl(url: string, consented: boolean): string;
export function sanitizeReferrer(referrer: string, consented: boolean): string | null;

// Payload utilities
export function cleanPayload<T extends Record<string, unknown>>(obj: T): Partial<T>;
export function generateId(): string;
export function formatAdBlockData(result: AdBlockResult | null): { adblock_detected: boolean | null; adblock_platforms: string | null };
export function getTimestamp(): number;
export function truncate(str: string, maxLength: number): string;

// User data utilities
export function buildUserData(data: unknown): UserData | undefined;
export function hashSHA256(value: string): Promise<string>;

// Consent state (4 flags like Shopify/sGTM)
export interface ConsentState {
    analytics: boolean;
    advertising: boolean;
    preferences: boolean;
    sale_of_data: boolean;
}

// User data address
export interface UserDataAddress {
    street?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
}

// User data (canonical format)
export interface UserData {
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
    address?: UserDataAddress;
}

// Attribution touchpoint
export interface Touchpoint {
    url: string;
    ts: number;
    ref?: string;
}

// AdBlock detection result
export interface AdBlockResult {
    detected: boolean | null;
    platforms: Record<string, boolean>;
    checkedAt: number;
}

// Product in event payload
export interface Product {
    id: string;
    sku?: string;
    name?: string;
    price?: number;
    currency?: string;
    brand?: string;
    category?: string;
    variant_title?: string;
    quantity?: number;
}

// Base event payload
export interface EventPayload {
    event_name: string;
    attribution_id: string;
    visitor_id: string;
    user_id?: string | null;
    event_time?: number;
    lib?: string;
    lib_version?: string;
    page_location?: string;
    page_referrer?: string;
    page_title?: string;
    raw_user_agent?: string;
    screen_resolution?: string;
    viewport_resolution?: string;
    timezone?: string;
    timezone_offset?: number;
    browser_language?: string;
    consent: {
        analytics: boolean;
        advertising: boolean;
        preferences: boolean;
        sale_of_data: boolean;
    };
    adblock_detected?: boolean | null;
    adblock_platforms?: string | null;
    user_data?: UserData;
    products?: Product[];
    conversion_id?: string | null;
    [key: string]: unknown;
}

// Event params
export interface EventParams {
    value?: number;
    currency?: string;
    transaction_id?: string | null;
    tax?: number;
    shipping?: number;
    search_term?: string;
    item_list_id?: string;
    item_list_name?: string;
    [key: string]: unknown;
}
