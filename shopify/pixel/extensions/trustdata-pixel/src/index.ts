import { register } from '@shopify/web-pixels-extension';
import { DEFAULT_SERVER_URL, STORAGE_KEYS, SHOPIFY_EVENT_MAP } from './constants';
import { detectAdBlock, formatAdBlockData } from './adblock';
import { getEventProperties, cleanPayload, buildUserData } from './utils';
import type { ConsentState, EventPayload, UserData, ShopifyBrowser, ShopifyContext, CustomerPrivacyApi } from './types';

/**
 * TrustData Shopify Web Pixel Extension v2
 *
 * Features:
 * - AdBlock detection (cached 24h)
 * - Attribution path tracking
 * - 4 consent flags (analytics, advertising, preferences, sale_of_data)
 * - user_data in sGTM format (nested address)
 * - Identity stitching on consent upgrade (stores server-returned visitor_id)
 *
 * Server handles: sessions, UTM parsing, device detection, geo enrichment
 */

register(async (api) => {
    const { analytics, browser, settings, init } = api;
    const customerPrivacy = (api as any).customerPrivacy as CustomerPrivacyApi;
    const shopDomain = (init.data as any)?.shop?.domain || '';

    // Get settings from extension config
    const serverUrl = (settings.serverUrl as string) || DEFAULT_SERVER_URL;
    const attributionId = (settings.attributionId as string) || '';
    const debug = settings.enableDebug === 'true';

    // Masking config: default false (no masking)
    const maskPersonalData = settings.maskPersonalData === 'true';

    if (!attributionId) {
        console.error('[TrustData] Missing attributionId');
        return;
    }

    if (debug) console.log('[TrustData] Init', { serverUrl, attributionId, shopDomain });

    // User ID from Shopify customer
    const userId = init.data?.customer?.id
        ? String(init.data.customer.id).replace(/[^0-9]/g, '')
        : null;

    // Initial consent state from init.customerPrivacy
    const initialPrivacy = (init as any).customerPrivacy;
    const consent: ConsentState = {
        analytics: initialPrivacy?.analyticsProcessingAllowed || false,
        advertising: initialPrivacy?.marketingAllowed || false,
        preferences: initialPrivacy?.preferencesProcessingAllowed || false,
        sale_of_data: initialPrivacy?.saleOfDataAllowed || false,
    };

    // Track initial consent state for identity stitching
    let hadConsentBefore = consent.analytics;

    // ========================================
    // Visitor ID Management for Identity Stitching
    // ========================================

    // Load stored visitor_id (fp_xxx from server when no consent)
    let storedVisitorId: string | null = null;
    try {
        storedVisitorId = await browser.localStorage.getItem(STORAGE_KEYS.VISITOR_ID);
    } catch {
        // Ignore
    }

    // Store server-returned visitor_id
    async function storeVisitorId(visitorId: string): Promise<void> {
        if (!visitorId) return;
        storedVisitorId = visitorId;
        if (!consent.analytics) return;
        try {
            await browser.localStorage.setItem(STORAGE_KEYS.VISITOR_ID, visitorId);
        } catch {
            // Ignore storage errors
        }
    }

    // Run adblock detection (may fail in Shopify sandbox due to fetch restrictions)
    let adBlockData: { adblock_detected: boolean | null; adblock_platforms: string | null } = {
        adblock_detected: null,
        adblock_platforms: null
    };
    try {
        const adBlockResult = await detectAdBlock(browser as unknown as ShopifyBrowser);
        adBlockData = formatAdBlockData(adBlockResult);
        if (debug) console.log('[TrustData] AdBlock:', adBlockData);
    } catch (e) {
        if (debug) console.log('[TrustData] AdBlock detection skipped (sandbox):', e);
    }

    // ========================================
    // User Data Management (sGTM format via core)
    // ========================================

    let userData: UserData | undefined;

    function setUser(data: any): void {
        if (!data) return;
        const newUserData = buildUserData(data);
        if (newUserData) {
            userData = { ...userData, ...newUserData };
        }
    }

    // Initialize user_data from logged-in customer
    if (init.data?.customer) {
        setUser(init.data.customer);
    }

    // ========================================
    // Event Helpers
    // ========================================

    function extractProducts(data: any, currencyCode?: string): any[] {
        // From checkout lineItems
        if (data?.checkout?.lineItems) {
            return data.checkout.lineItems.map((item: any) => ({
                id: item.variant?.sku || String(item.variant?.id || '').replace(/[^0-9]/g, ''),
                sku: item.variant?.sku,
                name: item.title,
                price: Number(item.variant?.price?.amount) || 0,
                currency: currencyCode || data.checkout?.currencyCode,
                quantity: item.quantity || 1,
            }));
        }

        // From cart lineItems
        if (data?.cart?.lines) {
            return data.cart.lines.map((line: any) => ({
                id: line.merchandise?.sku || String(line.merchandise?.id || '').replace(/[^0-9]/g, ''),
                sku: line.merchandise?.sku,
                name: line.merchandise?.product?.title,
                price: Number(line.merchandise?.price?.amount) || 0,
                currency: line.cost?.totalAmount?.currencyCode,
                quantity: line.quantity || 1,
            }));
        }

        // From cartLine (add to cart)
        if (data?.cartLine) {
            const line = data.cartLine;
            const variant = line.merchandise;
            return [{
                id: variant?.sku || String(variant?.id || '').replace(/[^0-9]/g, ''),
                sku: variant?.sku,
                name: variant?.product?.title,
                price: Number(variant?.price?.amount) || 0,
                currency: variant?.price?.currencyCode,
                quantity: line.quantity || 1,
            }];
        }

        // From productVariant (product viewed)
        if (data?.productVariant) {
            const variant = data.productVariant;
            return [{
                id: variant?.sku || String(variant?.id || '').replace(/[^0-9]/g, ''),
                sku: variant?.sku,
                name: variant?.product?.title,
                price: Number(variant?.price?.amount) || 0,
                currency: variant?.price?.currencyCode,
                brand: variant?.product?.vendor,
                category: variant?.product?.type,
                variant_title: variant?.title,
                quantity: 1,
            }];
        }

        // From collection products
        if (data?.collection?.productVariants) {
            return data.collection.productVariants.map((variant: any) => ({
                id: variant?.sku || String(variant?.id || '').replace(/[^0-9]/g, ''),
                sku: variant?.sku,
                name: variant?.product?.title,
                price: Number(variant?.price?.amount) || 0,
                currency: variant?.price?.currencyCode,
            }));
        }

        return [];
    }

    function extractValue(data: any): { value: number; currency?: string } {
        // Checkout total
        if (data?.checkout?.totalPrice) {
            return {
                value: Number(data.checkout.totalPrice.amount) || 0,
                currency: data.checkout.currencyCode,
            };
        }

        // Cart total
        if (data?.cart?.cost?.totalAmount) {
            return {
                value: Number(data.cart.cost.totalAmount.amount) || 0,
                currency: data.cart.cost.totalAmount.currencyCode,
            };
        }

        // Cart line
        if (data?.cartLine?.cost?.totalAmount) {
            return {
                value: Number(data.cartLine.cost.totalAmount.amount) || 0,
                currency: data.cartLine.merchandise?.price?.currencyCode,
            };
        }

        // Product variant
        if (data?.productVariant?.price) {
            return {
                value: Number(data.productVariant.price.amount) || 0,
                currency: data.productVariant.price.currencyCode,
            };
        }

        return { value: 0 };
    }

    /**
     * Send event to TrustData server
     * Returns the visitor_id from server response (for identity stitching)
     */
    async function sendEvent(
        eventName: string,
        eventData: Record<string, any> = {},
        context?: any,
        clientId?: string
    ): Promise<string | null> {
        // With consent: use clientId from Shopify
        // Without consent: don't send visitor_id, server generates fp_xxx
        const effectiveVisitorId = consent.analytics && clientId ? clientId : undefined;

        const ctx = context || init.context;
        const eventProps = getEventProperties(ctx as ShopifyContext, maskPersonalData);

        const payload: EventPayload = {
            ...eventProps,
            event_name: eventName,
            attribution_id: attributionId,
            visitor_id: effectiveVisitorId as string,
            user_id: consent.analytics ? userId : undefined,

            // Consent
            consent: {
                analytics: consent.analytics,
                advertising: consent.advertising,
                preferences: consent.preferences,
                sale_of_data: consent.sale_of_data,
            },

            // AdBlock
            ...adBlockData,

            // E-commerce
            products: eventData.products || [],
            conversion_id: eventData.conversion_id || null,

            // User data (if set)
            user_data: userData,
        };

        // Add event-specific params
        if (eventData.event_params) {
            Object.assign(payload, eventData.event_params);
        }

        const cleaned = cleanPayload(payload);
        if (debug) console.log('[TrustData] Send:', eventName, cleaned);

        try {
            const response = await fetch(serverUrl + '/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleaned),
            });

            // Store server-returned visitor_id for identity stitching
            if (response.ok) {
                const result = await response.json();
                if (result.visitor_id) {
                    await storeVisitorId(result.visitor_id);
                }
                return result.visitor_id || null;
            }
        } catch (e) {
            console.error('[TrustData] Error:', e);
        }

        return null;
    }

    /**
     * Send identity_link event to stitch previous (fp_xxx) to new (clientId)
     */
    async function sendIdentityLink(previousId: string, newId: string): Promise<void> {
        if (!previousId || !newId || previousId === newId) return;

        if (debug) console.log('[TrustData] Identity link:', previousId, '->', newId);

        const ctx = init.context;
        const eventProps = getEventProperties(ctx as ShopifyContext, maskPersonalData);

        const payload: EventPayload = {
            ...eventProps,
            event_name: 'identity_link',
            attribution_id: attributionId,
            visitor_id: newId,
            user_id: userId,

            consent: {
                analytics: consent.analytics,
                advertising: consent.advertising,
                preferences: consent.preferences,
                sale_of_data: consent.sale_of_data,
            },

            ...adBlockData,
        };

        // Add identity link params
        (payload as any).previous_visitor_id = previousId;
        (payload as any).new_visitor_id = newId;
        (payload as any).reason = 'consent_upgrade';

        const cleaned = cleanPayload(payload);

        try {
            await fetch(serverUrl + '/api/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cleaned),
            });
        } catch (e) {
            console.error('[TrustData] Identity link error:', e);
        }
    }

    // ========================================
    // Single Event Handler (all_standard_events)
    // ========================================

    analytics.subscribe('all_standard_events', (event) => {
        const shopifyEventName = event.name;
        const eventName = (SHOPIFY_EVENT_MAP as Record<string, string>)[shopifyEventName];
        const clientId = event.clientId;

        if (!eventName) {
            if (debug) console.log('[TrustData] Unmapped event:', shopifyEventName);
            return;
        }

        const data = event.data as any;
        const { value, currency } = extractValue(data);
        const products = extractProducts(data, currency);

        // Build event params
        const event_params: Record<string, any> = {};
        if (value) event_params.value = value;
        if (currency) event_params.currency = currency;

        // Event-specific handling
        switch (shopifyEventName) {
            case 'checkout_completed': {
                const checkout = data?.checkout;
                const orderId = checkout?.order?.id || checkout?.token;
                const transactionId = orderId ? String(orderId).replace(/[^0-9a-zA-Z]/g, '') : null;

                setUser(checkout);

                event_params.transaction_id = transactionId;
                event_params.tax = Number(checkout?.totalTax?.amount) || 0;
                event_params.shipping = Number(checkout?.shippingLine?.price?.amount) || 0;

                // Checkout token for webhook stitching
                if (checkout?.token) {
                    event_params.checkout_token = checkout.token;
                }

                // First order detection (customer ordersCount is count BEFORE this order)
                const customerOrdersCount = init.data?.customer?.ordersCount ?? 0;
                event_params.is_first_order = customerOrdersCount === 0;

                sendEvent(eventName, {
                    conversion_id: transactionId,
                    event_params,
                    products,
                }, event.context, clientId);
                break;
            }

            case 'checkout_started': {
                const checkout = data?.checkout;
                setUser(checkout);

                // Checkout token for webhook attribution stitching
                // link_id is the canonical field for attribution lookup
                if (checkout?.token) {
                    event_params.checkout_token = checkout.token;
                    event_params.link_id = checkout.token;
                }

                sendEvent(eventName, { event_params, products }, event.context, clientId);
                break;
            }

            case 'payment_info_submitted':
            case 'checkout_contact_info_submitted':
            case 'checkout_address_info_submitted':
            case 'checkout_shipping_info_submitted': {
                const checkout = data?.checkout;
                setUser(checkout);

                if (checkout?.token) {
                    event_params.checkout_token = checkout.token;
                }

                sendEvent(eventName, { event_params, products }, event.context, clientId);
                break;
            }

            case 'search_submitted': {
                event_params.search_term = data?.searchResult?.query;
                sendEvent(eventName, { event_params, products }, event.context, clientId);
                break;
            }

            case 'collection_viewed': {
                event_params.item_list_id = data?.collection?.id;
                event_params.item_list_name = data?.collection?.title;
                sendEvent(eventName, { event_params, products }, event.context, clientId);
                break;
            }

            default:
                sendEvent(eventName, { event_params, products }, event.context, clientId);
        }
    });

    // ========================================
    // Identity Stitching: Consent Change
    // ========================================

    // Subscribe to consent changes via customerPrivacy API
    customerPrivacy.subscribe('visitorConsentCollected', async (event: any) => {
        if (debug) console.log('[TrustData] visitorConsentCollected:', event);

        const newPrivacy = event.customerPrivacy;
        const wasConsentedBefore = consent.analytics;

        // Update local consent state
        consent.analytics = newPrivacy?.analyticsProcessingAllowed || false;
        consent.advertising = newPrivacy?.marketingAllowed || false;
        consent.preferences = newPrivacy?.preferencesProcessingAllowed || false;
        consent.sale_of_data = newPrivacy?.saleOfDataAllowed || false;

        // Consent upgraded from false to true
        if (consent.analytics && !wasConsentedBefore && !hadConsentBefore) {
            // Identity stitching
            const shopifyY = await browser.cookie.get('_shopify_y');
            if (storedVisitorId && storedVisitorId.startsWith('fp_') && shopifyY) {
                sendIdentityLink(storedVisitorId, shopifyY);
                if (debug) console.log('[TrustData] Identity linked:', storedVisitorId, '->', shopifyY);
            }
        }

        hadConsentBefore = consent.analytics;
        if (debug) console.log('[TrustData] Consent updated:', consent);
    });

    if (debug) console.log('[TrustData] Subscriptions registered');
});
