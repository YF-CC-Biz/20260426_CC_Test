#!/usr/bin/env node
// Exchange a freee OAuth2 authorization_code for an access_token, then
// write the token into `.env`. Reads credentials from `.env.token` so
// they never appear on the command line or in shell history.
//
// Usage:
//   1. Create `.env.token` with these three lines:
//        FREEE_CLIENT_ID=...
//        FREEE_CLIENT_SECRET=...
//        FREEE_AUTH_CODE=...
//      (Optionally also FREEE_REDIRECT_URI=... ; defaults to OOB.)
//   2. node scripts/exchange-token.mjs
//   3. `.env.token` is deleted on success so the single-use code can't
//      accidentally be reused.

import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const TOKEN_FILE_CANDIDATES = ["freee-credentials.txt", ".env.token"];
const TOKEN_FILE =
  TOKEN_FILE_CANDIDATES.map((p) => resolve(p)).find((p) => existsSync(p)) ??
  resolve(TOKEN_FILE_CANDIDATES[0]);
const ENV_FILE = resolve(".env");
const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function die(msg) {
  console.error(`[exchange-token] ${msg}`);
  process.exit(1);
}

if (!existsSync(TOKEN_FILE)) {
  die(
    `${TOKEN_FILE} not found. Create it with FREEE_CLIENT_ID, FREEE_CLIENT_SECRET, and FREEE_AUTH_CODE.`,
  );
}

const creds = parseEnv(readFileSync(TOKEN_FILE, "utf8"));
const clientId = creds.FREEE_CLIENT_ID;
const clientSecret = creds.FREEE_CLIENT_SECRET;
const authCode = creds.FREEE_AUTH_CODE;
const redirectUri = creds.FREEE_REDIRECT_URI || "urn:ietf:wg:oauth:2.0:oob";

for (const [name, val] of [
  ["FREEE_CLIENT_ID", clientId],
  ["FREEE_CLIENT_SECRET", clientSecret],
  ["FREEE_AUTH_CODE", authCode],
]) {
  if (!val) die(`${name} is missing in ${TOKEN_FILE}`);
}

console.error("[exchange-token] requesting access_token from freee…");

const body = new URLSearchParams({
  grant_type: "authorization_code",
  client_id: clientId,
  client_secret: clientSecret,
  code: authCode,
  redirect_uri: redirectUri,
});

const res = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});

const text = await res.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  die(`unexpected non-JSON response (${res.status}): ${text.slice(0, 200)}`);
}

if (!res.ok || !payload.access_token) {
  die(`freee returned ${res.status}: ${JSON.stringify(payload)}`);
}

const accessToken = payload.access_token;
const refreshToken = payload.refresh_token;
const expiresIn = payload.expires_in;

let envText = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
if (envText && !envText.endsWith("\n")) envText += "\n";

function upsert(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  return re.test(text) ? text.replace(re, line) : text + line + "\n";
}

envText = upsert(envText, "FREEE_ACCESS_TOKEN", accessToken);
if (refreshToken) envText = upsert(envText, "FREEE_REFRESH_TOKEN", refreshToken);

writeFileSync(ENV_FILE, envText);
try {
  chmodSync(ENV_FILE, 0o600);
} catch {
  // best-effort; ignore on platforms that don't support chmod
}

unlinkSync(TOKEN_FILE);

console.error(
  `[exchange-token] success. FREEE_ACCESS_TOKEN written to .env (expires in ~${expiresIn}s). ${TOKEN_FILE} removed.`,
);
