// ACC-PERIOD-003 — closed period is immutable.
// Anchor watched by drift: ACC-PERIOD-003.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPeriodImpl } from "../src/verify/impl-check.mjs";
import { periodSystem, modelCheck } from "../src/verify/model-check.mjs";
import { normalizePeriodCounterexample } from "../src/verify/counterexample.mjs";

test("ACC-PERIOD-003 implementation scenarios (open/closed × create/update/delete)", () => {
  const r = checkPeriodImpl();
  for (const c of r.checks) assert.equal(c.pass, true, c.name);
});

test("ACC-PERIOD-003 bounded model check: invariant holds over full state space", () => {
  const r = modelCheck(periodSystem());
  assert.equal(r.invariantHeld, true);
  assert.ok(r.distinct > 4, "state space should be non-trivial");
  assert.ok(r.depth >= 2, "must explore update-then-close orderings");
});

test("ACC-PERIOD-003 mutation: dropping the closed guard yields a counterexample", () => {
  const r = modelCheck(periodSystem({ mutation: "drop-closed-guard" }));
  assert.equal(r.invariantHeld, false, "TLC-style check must find a trace");
  const ce = normalizePeriodCounterexample(r.counterexample);
  assert.equal(ce.ruleId, "ACC-PERIOD-003");
  assert.equal(ce.generatedSelector, "ClosedPeriodImmutable");
  assert.ok(ce.trace.includes("ClosePeriod"), "trace must pass through ClosePeriod");
});

test("ACC-PERIOD-003 mutation: allowing only delete after close is still caught", () => {
  const r = modelCheck(periodSystem({ mutation: "allow-delete" }));
  assert.equal(r.invariantHeld, false);
});

test("ACC-PERIOD-003 mutation: allowing update after close is caught", () => {
  const r = modelCheck(periodSystem({ mutation: "allow-update" }));
  assert.equal(r.invariantHeld, false);
  const ce = normalizePeriodCounterexample(r.counterexample);
  const closeIdx = ce.trace.indexOf("ClosePeriod");
  const updIdx = ce.trace.lastIndexOf("UpdateJournal");
  assert.ok(closeIdx >= 0 && updIdx > closeIdx, "counterexample must update AFTER close");
});
