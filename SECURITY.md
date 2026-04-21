# Security

## Reporting a vulnerability

Email `security@trustdata.tech`. Please do **not** open a public GitHub issue for security reports.

Include:

- Affected integration and version
- Reproduction steps
- Impact assessment (what an attacker could do)

We acknowledge within 2 business days and aim to ship a fix within 14 days for high-severity issues. A CVE is issued for anything that affects deployed customer infrastructure.

## Verifying release artifacts

Every release on the [Releases page](https://github.com/trstdata/trustdata-integrations/releases) ships:

- The artifact (e.g. `trustdata-woocommerce-1.2.3.zip`)
- A SHA-256 checksum (`trustdata-woocommerce-1.2.3.zip.sha256`)
- A cosign signature (`trustdata-woocommerce-1.2.3.zip.sig`) and public key

To verify:

```bash
# Checksum
sha256sum -c trustdata-woocommerce-1.2.3.zip.sha256

# Signature (cosign keyless via GitHub OIDC)
cosign verify-blob \
  --certificate-identity-regexp 'https://github.com/trstdata/trustdata-integrations/.github/workflows/release.yml@.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --signature trustdata-woocommerce-1.2.3.zip.sig \
  trustdata-woocommerce-1.2.3.zip
```

## Scope

In scope for this repo:

- Code in `cloudflare/`, `woocommerce/`, `prestashop/`, `shopify/`
- Release artifacts published from this repo
- CI/CD configuration that produces those artifacts

Out of scope (report to `security@trustdata.tech` but not tracked here):

- The TrustData hosted platform (`trustdata.tech`, `app.trustdata.tech`, `t.trustdata.tech`)
- The ingest API specification itself
