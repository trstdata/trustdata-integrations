# Shopify Web Pixel

TrustData event capture for Shopify stores. Runs in Web Pixel sandbox with webhooks for server-side order tracking.

## Prerequisites

- Node.js 18+
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- Shopify Partner account
- Development store for testing

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

This will:
1. Start the Shopify CLI dev server
2. Prompt you to select/create a development store
3. Install the app on the dev store
4. Enable hot reloading for the pixel extension

## Deployment

```bash
npm run deploy
```

## Project Structure

```
shopify-pixels/
├── package.json
├── shopify.app.toml                    # App config (client_id, scopes, webhooks)
└── extensions/
    └── trustdata-pixel/
        ├── shopify.extension.toml      # Pixel settings schema
        └── src/
            └── index.ts                # Pixel logic
```

## Configuration

The pixel is configured via Shopify admin after installation:

| Setting | Description | Required |
|---------|-------------|----------|
| `serverUrl` | Event server URL (default: `https://t.trustdata.tech`) | No |
| `attributionId` | TrustData property ID | Yes |
| `enableDebug` | Enable console logging (`true`/`false`) | No |
| `maskPersonalData` | Strip personal data from URLs without consent (`true`/`false`, default: `false`) | No |

## Events Captured

| Shopify Event | TrustData Event | Data |
|---------------|-----------------|------|
| `page_viewed` | `page_view` | page_location, referrer |
| `product_viewed` | `view_item` | product (id, sku, name, price) |
| `collection_viewed` | `view_item_list` | collection id/name, products |
| `search_submitted` | `search` | search_term |
| `product_added_to_cart` | `add_to_cart` | product, quantity, value |
| `cart_viewed` | `view_cart` | products, cart total |
| `checkout_started` | `begin_checkout` | products, total, checkout_token |
| `checkout_contact_info_submitted` | `checkout_progress` | checkout_token |
| `checkout_address_info_submitted` | `checkout_progress` | checkout_token |
| `checkout_shipping_info_submitted` | `checkout_progress` | checkout_token |
| `payment_info_submitted` | `add_payment_info` | checkout_token |
| `checkout_completed` | `purchase` | transaction_id, products, tax, shipping, is_first_order |

## Webhooks

Configured in `shopify.app.toml`, handled by backend servers:

| Topics | Endpoint | Handler |
|--------|----------|---------|
| `orders/paid`, `orders/updated`, `orders/cancelled` | `t.trustdata.tech` | Go server |
| `customers/create` | `t.trustdata.tech` | Go server |
| `app/uninstalled` | `app.trustdata.tech` | Django |
| GDPR compliance | `app.trustdata.tech` | Django |

## Troubleshooting

### "command not found: shopify"

Install Shopify CLI globally:
```bash
npm install -g @shopify/cli
```

### Extension not updating

1. Clear browser cache
2. Restart `npm run dev`
3. Check the Shopify admin > Settings > Customer events

### Debug mode

Set `enableDebug` to `true` in the pixel settings, then check browser console for `[TrustData]` logs.

## Resources

- [Web Pixels API](https://shopify.dev/docs/api/web-pixels-api)
- [Standard Events](https://shopify.dev/docs/api/web-pixels-api/standard-events)
- [Customer Privacy API](https://shopify.dev/docs/api/web-pixels-api/objects/customerprivacy)
