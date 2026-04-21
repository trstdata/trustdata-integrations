/**
 * TrustData Shopify Pixel - Types
 * Re-exports from core + Shopify-specific types
 */

// Re-export core types
export type {
    ConsentState,
    UserData,
    UserDataAddress,
    Touchpoint,
    AdBlockResult,
    EventPayload,
    Product,
} from '@trustdata/tracking-core';

// Shopify-specific types

export interface ShopifyBrowser {
    cookie: {
        get(name: string): Promise<string | null>;
        set(name: string, value: string): Promise<void>;
    };
    localStorage: {
        getItem(key: string): Promise<string | null>;
        setItem(key: string, value: string): Promise<void>;
        removeItem(key: string): Promise<void>;
    };
}

export interface CustomerPrivacyApi {
    subscribe(event: 'visitorConsentCollected', callback: (event: any) => void): void;
}

export interface ShopifyContext {
    document?: {
        location?: { href?: string };
        referrer?: string;
        title?: string;
    };
    navigator?: {
        userAgent?: string;
        language?: string;
    };
    window?: {
        innerWidth?: number;
        innerHeight?: number;
        screen?: {
            width?: number;
            height?: number;
        };
    };
}
