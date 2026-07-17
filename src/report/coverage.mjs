// Coverage — does each approved rule actually earn the assurances it requires?
//
// Fails when:
//   - a clause is not covered by any check target
//   - a required assurance has no passing evidence of the right *kind*
//     (proved needs a proof/decision-procedure, bounded needs a model/relational
//      check — a passing unit test cannot satisfy either)
//   - a strong assurance is required but the primary backend is unmapped/textual
//     for a covering clause (over-claiming on a backend that can't carry it)

import { ASSURANCE_EVIDENCE_KIND, ASSURANCE_RANK } from "../core/classify.mjs";
import { runAllAssurance } from "../verify/run.mjs";

const STRONG = new Set(["bounded", "proved"]);

export function computeCoverage(ir, artifacts) {
  const assurance = runAllAssurance(ir, artifacts);
  const rules = [];
  let ok = true;

  for (const rule of ir.rules) {
    const problems = [];

    // clause coverage
    const covered = new Set();
    for (const ct of rule.checkTargets) for (const sel of ct.covers) covered.add(sel);
    for (const c of rule.clauses) {
      if (!covered.has(c.selector)) problems.push({ kind: "uncovered-clause", clause: c.selector });
    }

    // assurance satisfaction
    const results = assurance[rule.id] || [];
    const passingByKind = {};
    for (const r of results) if (r.result === "pass") (passingByKind[r.assuranceKind] ||= []).push(r);

    for (const req of rule.requiredAssurances) {
      const got = passingByKind[req] || [];
      if (!got.length) {
        problems.push({ kind: "missing-assurance", assurance: req });
        continue;
      }
      const wantKinds = ASSURANCE_EVIDENCE_KIND[req] || [];
      if (wantKinds.length && !got.some((g) => wantKinds.includes(g.evidenceKind))) {
        problems.push({ kind: "wrong-evidence-kind", assurance: req, wanted: wantKinds, got: got.map((g) => g.evidenceKind) });
      }
    }

    // over-claiming: strong assurance required but backend can't carry the clause
    const needsStrong = rule.requiredAssurances.some((a) => STRONG.has(a));
    if (needsStrong && rule.primaryBackend) {
      for (const c of rule.clauses) {
        const worst = c.applicability[rule.primaryBackend]?.worst;
        if (worst === "unmapped" || worst === "textual") {
          problems.push({ kind: "over-claim", clause: c.selector, backend: rule.primaryBackend, applicability: worst });
        }
      }
    }

    const ruleOk = problems.length === 0;
    ok = ok && ruleOk;
    rules.push({
      ruleId: rule.id,
      requiredAssurances: rule.requiredAssurances,
      achieved: Object.keys(passingByKind).sort((a, b) => ASSURANCE_RANK[a] - ASSURANCE_RANK[b]),
      ok: ruleOk,
      problems,
    });
  }

  return { ok, rules };
}
