# @trustdata/tracking-core

Shared tracking primitives used by the Shopify Web Pixel extension in
[`../pixel`](../pixel): URL masking, payload cleaning, user-data normalization,
and the constants both the pixel and the TrustData JS SDK agree on.

It is consumed as a local path dependency — `"@trustdata/tracking-core":
"file:../core"` — not from npm. It is **not** published to the registry.

## Why it lives here

`shopify/pixel` imports this package from four of its source files. Without it
in the repository the extension cannot be built by anyone who clones this repo:
`npm ci` still succeeds, but it leaves a dangling `node_modules` symlink and the
build fails on the unresolved imports.

## Keeping it in sync

This directory is a copy of `tracking/client/core` in the internal
`trustdata-cloud` repository, which is the source of truth. Only `src/` and
`package.json` are mirrored here — the GTM and sGTM templates that live
alongside it upstream are not part of this package.

**Change the upstream copy first, then mirror it here.** Bump `version` in both
`package.json` files together, so the version recorded in
`../pixel/package-lock.json` keeps matching what this directory contains. Mirror
`VERSION` in `src/constants.js` deliberately as well: it is a separate number
that ships as `lib_version` on every event, and nothing reconciles the two.

CI catches a partial sync through `npm run verify:core` in the pixel, which
imports this package and checks every symbol the pixel imports or re-exports. A
mirror that drops or renames one fails the build.

The pixel's typecheck does not catch it. `tsc` resolves this package through the
`types` entry and reads only `src/types.d.ts`, never the JavaScript beside it, so
a copy whose runtime exports were all deleted would still typecheck clean. That
declaration file is maintained by hand and is already incomplete: `PII_PARAMS`,
`sanitizePageUrl` and `sanitizeReferrer` are exported by `src/index.js` and not
declared in it. Add them there if the pixel ever needs them.
