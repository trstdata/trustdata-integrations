// Every symbol the pixel imports from @trustdata/tracking-core must exist at
// runtime in the vendored package.
//
// The pixel's typecheck cannot prove this. tsc resolves the package through its
// hand-written `types` entry (core/src/types.d.ts) and never opens a single .js
// file, so a mirror that drops or renames a runtime export still typechecks
// clean and then throws "x is not a function" in a merchant's storefront.
//
// This reads the pixel source and checks every symbol against the real module,
// so the check follows the code instead of a list kept by hand. It covers
// `export { x } from` re-exports as well as plain imports: utils.ts and types.ts
// pass most of the package straight through to the rest of the extension, and a
// re-export of a symbol that no longer exists fails exactly the same way.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = "@trustdata/tracking-core";
const SRC = "extensions/trustdata-pixel/src";

const IMPORT_BLOCK = new RegExp(
  String.raw`(?:import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]${PACKAGE}['"]`,
  "g",
);

// A value import must exist at runtime. A type-only import is erased before the
// pixel ships, so the declaration file is the only place it can be checked.
// Conflating the two is what makes this check worthless: every symbol the pixel
// uses is also named in types.d.ts, so a .d.ts fallback would pass a package
// whose runtime exports had all been deleted.
const values = new Map(); // symbol -> files, must exist on the module
const types_ = new Map(); // symbol -> files, must exist in types.d.ts

for (const file of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
  const body = readFileSync(join(SRC, file), "utf8");
  for (const [, typeOnlyBlock, names] of body.matchAll(IMPORT_BLOCK)) {
    for (const raw of names.split(",")) {
      const spec = raw.trim();
      if (!spec) continue;
      const typeOnly = Boolean(typeOnlyBlock) || /^type\s/.test(spec);
      // `Foo as Bar` imports Foo.
      const name = spec.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      const target = typeOnly ? types_ : values;
      target.set(name, [...(target.get(name) ?? []), file]);
    }
  }
}

const wanted = new Map([...values, ...types_]);

if (wanted.size === 0) {
  console.error(`No imports of ${PACKAGE} found in ${SRC}. This check is looking in the wrong place.`);
  process.exit(1);
}

const mod = await import(PACKAGE);
const types = readFileSync("../core/src/types.d.ts", "utf8");

const describe = (name, files, why) =>
  `  ${name} — ${why}, imported by ${[...new Set(files)].join(", ")}`;

const missing = [
  ...[...values]
    .filter(([name]) => !(name in mod))
    .map(([name, files]) => describe(name, files, "not exported at runtime")),
  ...[...types_]
    .filter(([name]) => !new RegExp(`\\b${name}\\b`).test(types))
    .map(([name, files]) => describe(name, files, "not declared in types.d.ts")),
];

if (missing.length) {
  console.error(
    `${PACKAGE} is missing ${missing.length} symbol(s) the pixel imports.\n` +
      `The vendored copy in shopify/core is out of step with the pixel:\n${missing.join("\n")}`,
  );
  process.exit(1);
}

console.log(`${PACKAGE}: all ${wanted.size} imported symbols resolve.`);
