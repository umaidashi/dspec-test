// Assurance engine.
//
// Runs the appropriate verifier for each assurance level a rule requires and
// returns structured results. This is the single place that maps
// activity → assurance, so no weaker activity can be mislabeled as a stronger
// guarantee. `check`, evidence creation, and reports all consume this.

import { periodSystem, syncSystem, modelCheck } from "./model-check.mjs";
import { relationalCheck } from "./relational-check.mjs";
import { checkLean } from "./lean-check.mjs";
import { runBalanceProperty, runBalanceExamples, BALANCE_MUTATIONS } from "./property-run.mjs";
import { normalizePeriodCounterexample, normalizeSyncCounterexample, normalizeTenantCounterexample } from "./counterexample.mjs";
import { checkPeriodImpl, checkTenantImpl, checkSyncImpl } from "./impl-check.mjs";

// One result object per (rule, assurance) actually established.
function ev(ruleId, assurance, extra) {
  return { ruleId, assuranceKind: assurance, result: "pass", ...extra };
}

export function runRuleAssurance(rule, artifacts) {
  const results = [];
  const arts = artifacts.filter((a) => a.ruleId === rule.id);

  // reference — implementation/test anchors are declared.
  if (rule.implementationRefs.length) {
    results.push(ev(rule.id, "reference", {
      evidenceKind: "source-link",
      tool: "dspec/refs",
      toolVersion: "1",
      refs: rule.implementationRefs.map((r) => `${r.file}#${r.anchor}`),
    }));
  }

  if (rule.id === "ACC-JOURNAL-001") {
    const prop = runBalanceProperty();
    const examples = runBalanceExamples();
    results.push(ev(rule.id, "executed", {
      evidenceKind: "property-run", tool: "dspec/property", toolVersion: "1",
      clauseSelector: "must[0]", generatedSelector: "prop_balanced",
      backend: "property",
      cases: prop.cases, examplesPassed: examples.checks.filter((c) => c.pass).length, result: prop.ok && examples.ok ? "pass" : "fail",
    }));
    // mutation-tested — each mutation must be caught (property fails).
    const caught = {};
    for (const [name, mut] of Object.entries(BALANCE_MUTATIONS)) {
      const r = runBalanceProperty({ predicate: mut });
      caught[name] = r.ok === false; // caught iff mutated predicate fails the property
    }
    results.push(ev(rule.id, "mutation-tested", {
      evidenceKind: "mutation-run", tool: "dspec/mutation", toolVersion: "1",
      clauseSelector: "must[0]", generatedSelector: "prop_balanced", backend: "property",
      mutationsCaught: caught, result: Object.values(caught).every(Boolean) ? "pass" : "fail",
    }));
    // proved — Lean / decision procedure.
    const lean = checkLean(arts.find((a) => a.backend === "lean"));
    results.push(ev(rule.id, "proved", {
      evidenceKind: lean.kind, tool: lean.tool, toolVersion: lean.toolVersion,
      backend: "lean", theoremName: "trial_balance_preserved",
      clauseSelector: "must[1]", generatedSelector: "trial_balance_preserved",
      result: lean.ok ? "pass" : "fail", detail: lean.theorems, note: lean.note,
    }));
  }

  if (rule.id === "ACC-PERIOD-003") {
    const mc = modelCheck(periodSystem());
    const impl = checkPeriodImpl();
    results.push(ev(rule.id, "executed", {
      evidenceKind: "test-run", tool: "dspec/impl", toolVersion: "1", backend: "implementation",
      clauseSelector: "must[0]", generatedSelector: "period-guard",
      scenarios: impl.checks.length, result: impl.ok ? "pass" : "fail",
    }));
    results.push(ev(rule.id, "bounded", {
      evidenceKind: "model-check", tool: "dspec/tlc-bmc", toolVersion: "1", backend: "tla",
      clauseSelector: "must[0]", generatedSelector: "ClosedPeriodImmutable", invariantName: "NoMutationWhenClosed",
      scope: mc.scope, bounds: { states: mc.states, distinct: mc.distinct, depth: mc.depth },
      result: mc.invariantHeld ? "pass" : "fail",
      counterexample: mc.invariantHeld ? null : normalizePeriodCounterexample(mc.counterexample),
    }));
  }

  if (rule.id === "ACC-SYNC-001") {
    const mc = modelCheck(syncSystem());
    const impl = checkSyncImpl();
    results.push(ev(rule.id, "executed", {
      evidenceKind: "test-run", tool: "dspec/impl", toolVersion: "1", backend: "implementation",
      clauseSelector: "must[0]", generatedSelector: "sync-idempotency",
      scenarios: impl.checks.length, result: impl.ok ? "pass" : "fail",
    }));
    results.push(ev(rule.id, "bounded", {
      evidenceKind: "model-check", tool: "dspec/tlc-bmc", toolVersion: "1", backend: "tla",
      clauseSelector: "must[0]", generatedSelector: "IdempotentExternalSync", invariantName: "IdempotentExternalSync",
      scope: mc.scope, bounds: { states: mc.states, distinct: mc.distinct, depth: mc.depth },
      result: mc.invariantHeld ? "pass" : "fail",
      counterexample: mc.invariantHeld ? null : normalizeSyncCounterexample(mc.counterexample),
    }));
  }

  if (rule.id === "ACC-TENANT-001") {
    const rc = relationalCheck();
    const impl = checkTenantImpl();
    results.push(ev(rule.id, "executed", {
      evidenceKind: "test-run", tool: "dspec/impl", toolVersion: "1", backend: "implementation",
      clauseSelector: "must[1]", generatedSelector: "repository-tenant-scope",
      scenarios: impl.checks.length, result: impl.ok ? "pass" : "fail",
    }));
    results.push(ev(rule.id, "bounded", {
      evidenceKind: "relational-check", tool: "dspec/alloy-bmc", toolVersion: "1", backend: "alloy",
      clauseSelector: "must[0]", generatedSelector: "TenantIsolation", invariantName: "TenantIsolation",
      scope: rc.scope, bounds: { structures: rc.structuresEnumerated },
      result: rc.invariantHeld ? "pass" : "fail",
      counterexample: rc.invariantHeld ? null : normalizeTenantCounterexample(rc.counterexample, rc.scope),
    }));
  }

  return results;
}

export function runAllAssurance(ir, artifacts) {
  const byRule = {};
  for (const rule of ir.rules) byRule[rule.id] = runRuleAssurance(rule, artifacts);
  return byRule;
}
