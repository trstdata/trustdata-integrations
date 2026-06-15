# TrustData Integrations

Customer-deployed integrations for [TrustData](https://trustdata.tech) — the code you run on your own infrastructure to send data into the TrustData platform.

This repo is **MIT-licensed** and intentionally thin. The TrustData product (Django app, ClickHouse marts, attribution engine) is a separate, private codebase — everything here is the glue that connects your stack to our ingest endpoints.

## What's in here

| Integration | Path | Deploy target | Stack |
|---|---|---|---|
| AI-bot collector | [`cloudflare/ai-bot-collector/`](./cloudflare/ai-bot-collector) | Cloudflare Workers | TypeScript |
| WooCommerce plugin | [`woocommerce/`](./woocommerce) | WordPress + WooCommerce | PHP |
| PrestaShop module | [`prestashop/`](./prestashop) | PrestaShop | PHP |
| Shopify pixel | [`shopify/pixel/`](./shopify/pixel) | Shopify Customer Events | TypeScript |

Each directory has its own README with install, configuration, and local-dev instructions.

## Prerequisites

You need a TrustData account and at least one **property** (attribution ID) to send data to. Sign up at [trustdata.tech](https://trustdata.tech) or email `hello@trustdata.tech`.

Each integration takes:

- `TRUSTDATA_API_KEY` — from **Settings → Data Sources** in the dashboard
- `TRUSTDATA_ATTRIBUTION_ID` — your TrustData attribution ID for the property you're sending data for

## Releases

Tagged releases publish pre-built artifacts (Worker bundle, plugin `.zip` files) to the [Releases page](https://github.com/trstdata/trustdata-integrations/releases). Artifacts are signed and checksummed; see [SECURITY.md](./SECURITY.md) for verification.

If you don't want to build from source:

- **Cloudflare Worker** — clone the tagged release, `npx wrangler deploy`
- **WooCommerce** — download `trustdata-woocommerce-<version>.zip`, upload through WP admin
- **PrestaShop** — download `trustdata-<version>.zip`, install through the module manager
- **Shopify pixel** — follow `shopify/pixel/README.md`

## Contributing

Bug reports and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Changes to the ingest wire format are coordinated with the private `trustdata-cloud` repo and cut as a new minor version here.

## License

MIT — see [LICENSE](./LICENSE). The TrustData product itself is not open source; this repo only covers the integrations you deploy on your own infrastructure.

## Links

- Product: [trustdata.tech](https://trustdata.tech)
- Docs: [docs.trustdata.tech](https://docs.trustdata.tech)
- Security disclosure: `security@trustdata.tech` (see [SECURITY.md](./SECURITY.md))
