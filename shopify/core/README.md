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

**Change the upstream copy first, then mirror it here** and bump `version` in
both `package.json` files together, so the version recorded in
`../pixel/package-lock.json` keeps matching what this directory actually
contains. CI typechecks the pixel against this source, so a partial sync that
drops a symbol the pixel imports fails the build.
