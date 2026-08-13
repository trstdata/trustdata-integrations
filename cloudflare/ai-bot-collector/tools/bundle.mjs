// Produces worker.bundle.js from the wrangler dry-run output: strips the
// sourcemap pointer and stamps the version on line 1, so paste-deploy users
// can answer "which version am I running?" by looking at the top of the
// editor. Run via `npm run bundle`.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const js = readFileSync("dist/index.js", "utf8").replace(
  /^\/\/# sourceMappingURL=.*\n?/m,
  "",
);
writeFileSync(
  "worker.bundle.js",
  `// trustdata-ai-bot-collector v${version}\n${js}`,
);
