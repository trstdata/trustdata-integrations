#!/usr/bin/env node
// Reproducible Web Bot Auth (RFC 9421) signed-request generator, for testing the
// Worker's edge signature verification against a real staging zone.
//
// It mints a fresh Ed25519 key, builds a valid HTTP Message Signature over
// ("@authority" "@path") — the same signature base the Worker rebuilds — writes
// the key directory (JWKS) you must host, self-checks the signature locally, and
// either prints a ready curl command or sends the request itself.
//
// Usage:
//   node tools/sign-request.mjs --target https://zone.example.com/robots.txt \
//        --directory https://you.example.com/keys [--ua "GPTBot/1.0"] [--send]
//
//   1. Run it → it writes ./directory.json and prints next steps.
//   2. Host directory.json at exactly the --directory URL (must be reachable
//      from Cloudflare's edge — a Pages/R2/gist raw URL works).
//   3. Re-run with --send (or run the printed curl) to hit the zone.
//   4. Confirm the resulting cloudflare_bot_visit event has
//      bot_verified=true, bot_verified_by=signature.
//
// Refs: RFC 9421, RFC 7638, https://blog.cloudflare.com/web-bot-auth/

import { generateKeyPairSync, sign, verify, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const target = arg("target");
const directory = arg("directory");
const ua = arg("ua", "GPTBot/1.0");
if (!target || !directory) {
  console.error("usage: node tools/sign-request.mjs --target <url> --directory <jwks-url> [--ua <ua>] [--send]");
  process.exit(1);
}

const url = new URL(target);
const authority = url.host;
const path = url.pathname || "/";

// Fresh Ed25519 keypair.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const jwk = publicKey.export({ format: "jwk" }); // { kty:"OKP", crv:"Ed25519", x:"..." }

// RFC 7638 thumbprint (the Web Bot Auth keyid).
const thumbInput = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
const keyid = createHash("sha256").update(thumbInput).digest("base64url");

const created = Math.floor(Date.now() / 1000);
const rawParams = `("@authority" "@path");created=${created};keyid="${keyid}";alg="ed25519"`;
const base = [
  `"@authority": ${authority}`,
  `"@path": ${path}`,
  `"@signature-params": ${rawParams}`,
].join("\n");

const signature = sign(null, Buffer.from(base), privateKey);
const sigB64 = signature.toString("base64");

// Local self-check: the signature must verify against its own public key.
if (!verify(null, Buffer.from(base), publicKey, signature)) {
  console.error("self-check FAILED — signature does not verify locally");
  process.exit(1);
}

const directoryJson = JSON.stringify({ keys: [jwk] }, null, 2);
writeFileSync("directory.json", directoryJson);

const headers = {
  "User-Agent": ua,
  Signature: `sig1=:${sigB64}:`,
  "Signature-Input": `sig1=${rawParams}`,
  "Signature-Agent": `"${directory}"`,
};

console.log("self-check OK — signature verifies locally\n");
console.log("signature base:\n" + base + "\n");
console.log(`wrote directory.json — host it at: ${directory}\n`);

if (flag("send")) {
  const resp = await fetch(target, { headers });
  console.log(`sent → HTTP ${resp.status}`);
  console.log("Now check the cloudflare_bot_visit event: bot_verified=true, bot_verified_by=signature");
} else {
  const curl = `curl -sS "${target}" \\\n` +
    Object.entries(headers)
      .map(([k, v]) => `  -H ${JSON.stringify(`${k}: ${v}`)}`)
      .join(" \\\n");
  console.log("once directory.json is hosted, run:\n");
  console.log(curl + "\n");
  console.log("or re-run this script with --send");
}
