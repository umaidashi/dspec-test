// Drift detection.
//
// A rule points at two kinds of external artifacts that can silently diverge
// from the spec: hand-maintained implementation/test anchors, and generated
// backend artifacts whose theorem / invariant / assertion names the spec pins
// via `checkTarget.generatedSelector`. Drift = a pinned name/anchor no longer
// present where the spec says it should be.

import { existsSync, readFileSync } from "node:fs";
import { emitAll } from "../backends/index.mjs";

// backend -> on-disk generated artifact path, derived from the emitters.
function generatedPaths(ir) {
  const map = {};
  for (const a of emitAll(ir)) {
    map[`${a.backend}:${a.ruleId}`] = a.path;
  }
  return map;
}

export function detectDrift(ir) {
  const findings = [];
  const genPaths = generatedPaths(ir);

  for (const rule of ir.rules) {
    // 1. implementation / test anchors must exist in their files.
    for (const ref of rule.implementationRefs) {
      if (!existsSync(ref.file)) {
        findings.push({ ruleId: rule.id, kind: "missing-file", file: ref.file, anchor: ref.anchor });
        continue;
      }
      const text = readFileSync(ref.file, "utf8");
      if (!text.includes(ref.anchor)) {
        findings.push({ ruleId: rule.id, kind: "missing-anchor", refKind: ref.kind, file: ref.file, anchor: ref.anchor });
      }
    }

    // 2. generated selectors (theorem/invariant/assertion) must exist in the
    //    on-disk generated artifact for the target backend.
    for (const ct of rule.checkTargets) {
      if (!ct.generatedSelector) continue;
      if (ct.backend === "implementation") continue; // covered by anchors above
      if (ct.backend === "property") {
        // property targets live in the rule's referenced test files
        const testRefs = rule.implementationRefs.filter((r) => r.kind === "test");
        const found = testRefs.some((r) => existsSync(r.file) && readFileSync(r.file, "utf8").includes(ct.generatedSelector));
        if (!found) {
          findings.push({
            ruleId: rule.id, kind: "renamed-generated-selector", backend: "property",
            generatedSelector: ct.generatedSelector,
            message: `no referenced test file defines "${ct.generatedSelector}"`,
          });
        }
        continue;
      }
      const path = genPaths[`${ct.backend}:${rule.id}`];
      if (!path) {
        findings.push({ ruleId: rule.id, kind: "no-generated-artifact", backend: ct.backend, generatedSelector: ct.generatedSelector });
        continue;
      }
      if (!existsSync(path)) {
        findings.push({ ruleId: rule.id, kind: "generated-not-emitted", backend: ct.backend, path, generatedSelector: ct.generatedSelector });
        continue;
      }
      const text = readFileSync(path, "utf8");
      if (!text.includes(ct.generatedSelector)) {
        findings.push({
          ruleId: rule.id, kind: "renamed-generated-selector", backend: ct.backend, path,
          generatedSelector: ct.generatedSelector,
          message: `${ct.backend} artifact no longer defines "${ct.generatedSelector}"`,
        });
      }
    }
  }

  return { ok: findings.length === 0, findings };
}
