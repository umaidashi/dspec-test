import { emitLean } from "./lean.mjs";
import { emitTla } from "./tla.mjs";
import { emitAlloy } from "./alloy.mjs";
import { digestText } from "../core/digest.mjs";

// Emit every backend artifact for an IR. Returns a flat list of artifacts, each
// { backend, ruleId, path, cfgPath?, text, cfg?, generated, digest }.
export function emitAll(ir) {
  // The MVP emitters are rule-specific: each one owns exactly the rule the
  // router assigned to its backend, and emits nothing for models without it.
  const arts = [];
  if (ir.rules.some((r) => r.id === "ACC-JOURNAL-001")) arts.push(emitLean(ir));
  arts.push(...emitTla(ir));
  if (ir.rules.some((r) => r.id === "ACC-TENANT-001")) arts.push(emitAlloy(ir));
  for (const a of arts) a.digest = digestText(a.text + (a.cfg || ""));
  return arts;
}

export { emitLean, emitTla, emitAlloy };
