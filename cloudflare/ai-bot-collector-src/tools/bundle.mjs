// Regenerates the seed's worker.bundle.js — the copy-paste install path, for
// customers with no Git account (README: paste it into the dashboard editor).
//
// The Worker is a single self-contained module with no runtime dependencies,
// so the tsc output IS the complete Worker; no bundler is involved. Building
// from dist/ rather than `wrangler deploy --dry-run` keeps the committed file
// byte-stable across wrangler upgrades and identical to what npm publishes.
//
// Run via `npm run bundle` (which builds first). CI re-runs it and fails if the
// committed bundle differs, so the paste path can never ship stale code.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const dist = new URL("../dist/index.js", import.meta.url);
const seedBundle = new URL("../../ai-bot-collector/worker.bundle.js", import.meta.url);

const js = readFileSync(dist, "utf8").replace(/^\/\/# sourceMappingURL=.*\n?/m, "");

// Line 1 is how a paste-deploy customer identifies their version: the docs tell
// them to read the top of the Cloudflare code editor.
writeFileSync(seedBundle, `// ${pkg.name} v${pkg.version}\n${js}`);
