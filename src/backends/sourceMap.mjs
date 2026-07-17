// Bidirectional source map.
//
// Ties every rule to its clauses, Core IR nodes, backend generated selectors,
// evidence, and implementation references:
//
//   Pkl Rule → Clause selector → Core IR node → backend generated selector
//            → evidence → implementation reference
//
// Both directions are queryable so a backend counterexample or a stale evidence
// record can be traced straight back to the authoring rule.

import { digest } from "../core/digest.mjs";

export function buildSourceMap(ir, artifacts, evidence = []) {
  const evByGen = new Map();
  for (const e of evidence) {
    const g = e.generatedSelector || "";
    if (!evByGen.has(g)) evByGen.set(g, []);
    evByGen.get(g).push({ evidenceId: e.evidenceId, backend: e.backend, assurance: e.assuranceKind, result: e.result });
  }

  const rules = ir.rules.map((rule) => {
    const arts = artifacts.filter((a) => a.ruleId === rule.id);
    const entries = [];
    for (const c of rule.clauses) {
      const genForClause = [];
      for (const a of arts) {
        for (const g of a.generated) {
          if (g.covers.includes(c.selector)) {
            genForClause.push({
              backend: a.backend,
              generatedSelector: g.selector,
              artifact: a.path,
              artifactDigest: a.digest,
              evidence: evByGen.get(g.selector) || [],
            });
          }
        }
      }
      entries.push({
        clause: c.selector,
        coreIRNode: `clause:${rule.id}#${c.selector}`,
        irKind: c.irKind,
        render: c.render,
        generated: genForClause,
      });
    }
    return {
      ruleId: rule.id,
      classification: rule.classification,
      primaryStrategy: rule.primaryStrategy,
      primaryBackend: rule.primaryBackend,
      clauses: entries,
      implementationRefs: rule.implementationRefs.map((r) => ({ kind: r.kind, file: r.file, anchor: r.anchor })),
    };
  });

  const map = { version: 1, model: ir.model.id, modelIRDigest: ir.digest, rules };
  map.digest = digest(map);
  return map;
}

// Reverse lookups.
export function findByGeneratedSelector(map, generatedSelector) {
  for (const r of map.rules)
    for (const c of r.clauses)
      for (const g of c.generated)
        if (g.generatedSelector === generatedSelector) return { ruleId: r.ruleId, clause: c.clause, ...g };
  return null;
}

export function findByClause(map, ruleId, selector) {
  const r = map.rules.find((x) => x.ruleId === ruleId);
  return r?.clauses.find((c) => c.clause === selector) || null;
}
