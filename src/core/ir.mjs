// Canonical Core IR.
//
// Neither Pkl nor any backend interprets the other directly. The raw parsed
// model is normalized here into a single IR that every backend reads. The IR
// makes each element's *kind* explicit (entity / value / state / operation /
// predicate / invariant / relation / transition / temporal-property /
// implementation-reference / verification-target) and attaches, per clause, the
// backend applicability of every operator it uses.

import { parseExpr, renderExpr, freeVars } from "./expr.mjs";
import { exprApplicability, BACKENDS } from "./applicability.mjs";
import { primaryStrategy, STRATEGY_BACKEND } from "./classify.mjs";
import { digest } from "./digest.mjs";

// Classification → the IR predicate-kind its clauses represent.
const CLAUSE_IR_KIND = {
  "pure-invariant": "invariant",
  "numeric-invariant": "invariant",
  "relational-invariant": "relation",
  "state-transition": "transition",
  "temporal-property": "temporal-property",
  "authorization-policy": "relation",
  "runtime-obligation": "predicate",
};

function normalizeClause(clause, classification) {
  const expr = parseExpr(clause.ast);
  const applicability = {};
  for (const b of BACKENDS) applicability[b] = exprApplicability(expr, b);
  return {
    selector: clause.selector,
    kind: clause.kind, // must | mustNot
    irKind: CLAUSE_IR_KIND[classification] || "predicate",
    source: clause.ast,
    render: renderExpr(expr),
    expr,
    freeVars: [...freeVars(expr)].sort(),
    labelJa: clause.labelJa,
    labelEn: clause.labelEn,
    applicability,
  };
}

function routeRule(rule, clauses) {
  const strategy = primaryStrategy(rule);
  const backend = STRATEGY_BACKEND[strategy];
  let ok = true;
  let reason = "ok";
  if (backend) {
    for (const c of clauses) {
      const worst = c.applicability[backend]?.worst;
      if (worst === "unmapped" || worst === "textual") {
        ok = false;
        reason = `clause ${c.selector} is ${worst} on backend ${backend}`;
        break;
      }
    }
  } else {
    reason = "no backend (runtime strategy)";
  }
  return { strategy, backend, ok, reason };
}

export function normalizeRule(rule) {
  const clauses = (rule.clauses || []).map((c) => normalizeClause(c, rule.classification));
  const routing = routeRule(rule, clauses);
  return {
    id: rule.id,
    titleJa: rule.titleJa,
    titleEn: rule.titleEn,
    specJa: rule.specJa,
    specEn: rule.specEn,
    classification: rule.classification,
    primaryStrategy: routing.strategy,
    primaryBackend: routing.backend,
    routing,
    auxiliaryStrategies: rule.auxiliaryStrategies || [],
    requiredAssurances: rule.requiredAssurances || [],
    clauses,
    checkTargets: (rule.checkTargets || []).map((ct) => ({
      backend: ct.backend,
      coverage: ct.coverage,
      covers: ct.covers || [],
      generatedSelector: ct.generatedSelector,
    })),
    implementationRefs: (rule.implementationRefs || []).map((r) => ({ ...r })),
    proves: { ja: rule.provesJa, en: rule.provesEn },
    notProven: { ja: rule.notProvenJa, en: rule.notProvenEn },
  };
}

export function toCoreIR(model) {
  const rules = (model.rules || []).map(normalizeRule);
  const ir = {
    version: 1,
    model: {
      id: model.id,
      titleJa: model.titleJa,
      titleEn: model.titleEn,
      boundaryJa: model.boundaryJa,
      boundaryEn: model.boundaryEn,
    },
    vocabulary: (model.terms || []).map((t) => ({ id: t.id, labelJa: t.labelJa, labelEn: t.labelEn })),
    domainTypes: (model.domainTypes || []).map((d) => ({
      id: d.id,
      irKind: d.kind, // entity | value | state
      labelJa: d.labelJa,
      labelEn: d.labelEn,
      fields: (d.fields || []).map((f) => ({ name: f.name, type: f.type })),
    })),
    rules,
    nonGoals: model.nonGoals || [],
  };
  ir.digest = digest(stripDigest(ir));
  return ir;
}

function stripDigest(ir) {
  const { digest: _d, ...rest } = ir;
  return rest;
}

// Enumerate every IR node with a stable node id, for source maps and docs.
export function irNodes(ir) {
  const nodes = [];
  for (const t of ir.domainTypes) {
    nodes.push({ nodeId: `type:${t.id}`, kind: t.irKind, ref: t.id });
    for (const f of t.fields) nodes.push({ nodeId: `type:${t.id}.${f.name}`, kind: "field", ref: `${t.id}.${f.name}` });
  }
  for (const r of ir.rules) {
    nodes.push({ nodeId: `rule:${r.id}`, kind: "verification-target", ref: r.id });
    for (const c of r.clauses) {
      nodes.push({ nodeId: `clause:${r.id}#${c.selector}`, kind: c.irKind, ref: `${r.id}#${c.selector}`, render: c.render });
    }
  }
  return nodes;
}

export { BACKENDS };
