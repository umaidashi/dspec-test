import { createHash } from "node:crypto";

// Stable, order-independent digest of any JSON-serializable value. Object keys
// are sorted so digests depend on content, not authoring order. Used to detect
// drift between a spec, its Core IR, generated artifacts, and recorded evidence.
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] === undefined) continue;
    out[k] = canonicalize(value[k]);
  }
  return out;
}

export function digest(value) {
  const json = JSON.stringify(canonicalize(value));
  return "sha256:" + createHash("sha256").update(json).digest("hex").slice(0, 32);
}

export function digestText(text) {
  return "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 32);
}
