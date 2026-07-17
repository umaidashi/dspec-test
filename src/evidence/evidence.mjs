// Evidence model — create / verify / refresh.
//
// An evidence record binds a verification RESULT to the exact inputs that
// produced it (model, Core IR, source map, and generated-artifact digests).
// `verify` recomputes those digests from the current sources; if any differ,
// the evidence is STALE and must not be trusted as current. This is what stops
// an old green result from vouching for changed code.

import { existsSync, readFileSync } from "node:fs";
import { digest, digestText } from "../core/digest.mjs";
import { runAllAssurance } from "../verify/run.mjs";

const EVIDENCE_DIR = "generated/evidence";
const EVIDENCE_FILE = `${EVIDENCE_DIR}/evidence.json`;

function artifactDigestFor(artifacts, backend, ruleId) {
  const a = artifacts.find((x) => x.backend === backend && x.ruleId === ruleId);
  return a?.digest || null;
}

// Build fresh evidence records from an IR + artifacts + source map.
export function createEvidence({ ir, artifacts, sourceMap, modelDigest }) {
  const assurance = runAllAssurance(ir, artifacts);
  const records = [];
  for (const rule of ir.rules) {
    for (const r of assurance[rule.id]) {
      const artifactDigest = r.backend ? artifactDigestFor(artifacts, r.backend, rule.id) : null;
      const rec = {
        ruleId: rule.id,
        clauseSelector: r.clauseSelector || null,
        generatedSelector: r.generatedSelector || null,
        backend: r.backend || null,
        tool: r.tool,
        toolVersion: r.toolVersion,
        result: r.result,
        assuranceKind: r.assuranceKind,
        evidenceKind: r.evidenceKind,
        scope: r.scope || null,
        bounds: r.bounds || null,
        theoremName: r.theoremName || null,
        invariantName: r.invariantName || null,
        modelDigest,
        coreIRDigest: ir.digest,
        sourceMapDigest: sourceMap.digest,
        artifactDigest,
        counterexample: r.counterexample || null,
      };
      // The bound context: any change to these inputs makes the record stale.
      rec.contextDigest = digest({
        modelDigest, coreIRDigest: ir.digest, sourceMapDigest: sourceMap.digest, artifactDigest,
        ruleId: rec.ruleId, generatedSelector: rec.generatedSelector, assuranceKind: rec.assuranceKind,
      });
      rec.evidenceId = digest({ ...rec, contextDigest: rec.contextDigest }).replace("sha256:", "ev_");
      records.push(rec);
    }
  }
  return records;
}

// On-disk generated artifacts must match what the current spec emits; a stale
// or hand-edited artifact must not be vouched for by recorded evidence.
function checkArtifactsOnDisk(artifacts) {
  const findings = [];
  for (const a of artifacts) {
    if (!existsSync(a.path)) {
      findings.push({ status: "artifact-missing", backend: a.backend, ruleId: a.ruleId, path: a.path });
      continue;
    }
    const onDisk = readFileSync(a.path, "utf8") + (a.cfgPath && existsSync(a.cfgPath) ? readFileSync(a.cfgPath, "utf8") : "");
    if (digestText(onDisk) !== a.digest) {
      findings.push({ status: "artifact-modified", backend: a.backend, ruleId: a.ruleId, path: a.path });
    }
  }
  return findings;
}

// Verify stored evidence against freshly computed digests.
export function verifyEvidence({ stored, ir, artifacts, sourceMap, modelDigest }) {
  const fresh = createEvidence({ ir, artifacts, sourceMap, modelDigest });
  const diskFindings = checkArtifactsOnDisk(artifacts);
  const freshByCtx = new Map(fresh.map((r) => [`${r.ruleId}|${r.generatedSelector}|${r.assuranceKind}`, r]));
  const findings = [];
  for (const s of stored) {
    const kkey = `${s.ruleId}|${s.generatedSelector}|${s.assuranceKind}`;
    const f = freshByCtx.get(kkey);
    if (!f) {
      findings.push({ evidenceId: s.evidenceId, ruleId: s.ruleId, status: "orphaned", reason: "no current verification matches this record" });
      continue;
    }
    if (f.contextDigest !== s.contextDigest) {
      findings.push({
        evidenceId: s.evidenceId, ruleId: s.ruleId, status: "stale",
        reason: "inputs changed since evidence was recorded",
        changed: diffDigests(s, f),
      });
    } else if (f.result !== s.result) {
      findings.push({ evidenceId: s.evidenceId, ruleId: s.ruleId, status: "result-changed", from: s.result, to: f.result });
    } else {
      findings.push({ evidenceId: s.evidenceId, ruleId: s.ruleId, status: "current" });
    }
  }
  findings.push(...diskFindings);
  const ok = findings.every((f) => f.status === "current");
  return { ok, findings, fresh };
}

function diffDigests(a, b) {
  const keys = ["modelDigest", "coreIRDigest", "sourceMapDigest", "artifactDigest"];
  return keys.filter((k) => a[k] !== b[k]);
}

export { EVIDENCE_DIR, EVIDENCE_FILE };
