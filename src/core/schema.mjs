// Runtime validator mirroring dspec/Schema.pkl. When the real `pkl` binary is
// present the CLI will additionally shell out to it; this mirror keeps the
// toolchain self-contained and is what `dspec check` uses for type checking.

import { CLASSIFICATIONS, STRATEGIES, ASSURANCE } from "./classify.mjs";
import { parseExpr } from "./expr.mjs";

const DOMAIN_KINDS = ["entity", "value", "state"];
const CLAUSE_KINDS = ["must", "mustNot"];
const CHECK_BACKENDS = ["lean", "tla", "alloy", "property", "implementation"];
const IMPL_KINDS = ["implementation", "test", "db-constraint"];

class V {
  constructor() {
    this.errors = [];
  }
  err(path, msg) {
    this.errors.push(`${path}: ${msg}`);
  }
  str(path, v) {
    if (typeof v !== "string" || v.length === 0) this.err(path, "expected non-empty String");
  }
  optStr(path, v) {
    if (v !== undefined && typeof v !== "string") this.err(path, "expected String");
  }
  oneOf(path, v, set) {
    if (!set.includes(v)) this.err(path, `expected one of ${set.join("|")}, got ${JSON.stringify(v)}`);
  }
  list(path, v) {
    if (!Array.isArray(v)) {
      this.err(path, "expected Listing");
      return [];
    }
    return v;
  }
}

export function validateModel(model) {
  const v = new V();
  v.str("id", model.id);
  v.str("titleJa", model.titleJa);
  v.str("titleEn", model.titleEn);
  v.str("boundaryJa", model.boundaryJa);
  v.str("boundaryEn", model.boundaryEn);

  for (const [i, t] of v.list("terms", model.terms).entries()) {
    v.str(`terms[${i}].id`, t.id);
    v.str(`terms[${i}].labelJa`, t.labelJa);
    v.str(`terms[${i}].labelEn`, t.labelEn);
  }

  const typeIds = new Set();
  for (const [i, d] of v.list("domainTypes", model.domainTypes).entries()) {
    v.str(`domainTypes[${i}].id`, d.id);
    typeIds.add(d.id);
    v.oneOf(`domainTypes[${i}].kind`, d.kind, DOMAIN_KINDS);
    for (const [j, f] of v.list(`domainTypes[${i}].fields`, d.fields).entries()) {
      v.str(`domainTypes[${i}].fields[${j}].name`, f.name);
      v.str(`domainTypes[${i}].fields[${j}].type`, f.type);
    }
  }

  const ruleIds = new Set();
  for (const [i, r] of v.list("rules", model.rules).entries()) {
    const p = `rules[${i}]`;
    v.str(`${p}.id`, r.id);
    if (ruleIds.has(r.id)) v.err(`${p}.id`, `duplicate rule id ${r.id}`);
    ruleIds.add(r.id);
    v.str(`${p}.titleJa`, r.titleJa);
    v.str(`${p}.titleEn`, r.titleEn);
    v.str(`${p}.specJa`, r.specJa);
    v.str(`${p}.specEn`, r.specEn);
    v.oneOf(`${p}.classification`, r.classification, CLASSIFICATIONS);
    if (r.primaryStrategy !== undefined) v.oneOf(`${p}.primaryStrategy`, r.primaryStrategy, STRATEGIES);
    for (const [j, s] of v.list(`${p}.auxiliaryStrategies`, r.auxiliaryStrategies).entries()) {
      v.oneOf(`${p}.auxiliaryStrategies[${j}]`, s, STRATEGIES);
    }
    const req = v.list(`${p}.requiredAssurances`, r.requiredAssurances);
    for (const [j, a] of req.entries()) v.oneOf(`${p}.requiredAssurances[${j}]`, a, ASSURANCE);

    const selectors = new Set();
    for (const [j, c] of v.list(`${p}.clauses`, r.clauses).entries()) {
      const cp = `${p}.clauses[${j}]`;
      v.str(`${cp}.selector`, c.selector);
      selectors.add(c.selector);
      v.oneOf(`${cp}.kind`, c.kind, CLAUSE_KINDS);
      v.str(`${cp}.ast`, c.ast);
      try {
        parseExpr(c.ast);
      } catch (e) {
        v.err(`${cp}.ast`, `unparseable clause expression: ${e.message}`);
      }
    }

    for (const [j, ct] of v.list(`${p}.checkTargets`, r.checkTargets).entries()) {
      const tp = `${p}.checkTargets[${j}]`;
      v.oneOf(`${tp}.backend`, ct.backend, CHECK_BACKENDS);
      v.oneOf(`${tp}.coverage`, ct.coverage, ["clause", "rule"]);
      for (const [k, sel] of v.list(`${tp}.covers`, ct.covers).entries()) {
        v.str(`${tp}.covers[${k}]`, sel);
        if (!selectors.has(sel)) v.err(`${tp}.covers[${k}]`, `covers unknown clause selector ${sel}`);
      }
    }

    for (const [j, ir] of v.list(`${p}.implementationRefs`, r.implementationRefs).entries()) {
      const rp = `${p}.implementationRefs[${j}]`;
      v.oneOf(`${rp}.kind`, ir.kind, IMPL_KINDS);
      v.str(`${rp}.file`, ir.file);
      v.str(`${rp}.anchor`, ir.anchor);
    }
  }

  for (const [i, g] of v.list("nonGoals", model.nonGoals).entries()) v.str(`nonGoals[${i}]`, g);

  return v.errors;
}
