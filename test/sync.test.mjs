// ACC-SYNC-001 — external sync idempotency.
// Anchor watched by drift: ACC-SYNC-001.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSyncImpl } from "../src/verify/impl-check.mjs";
import { syncSystem, modelCheck } from "../src/verify/model-check.mjs";
import { normalizeSyncCounterexample } from "../src/verify/counterexample.mjs";

test("ACC-SYNC-001 implementation scenarios (retry, conflict, tenant/provider variance)", () => {
  const r = checkSyncImpl();
  for (const c of r.checks) assert.equal(c.pass, true, c.name);
});

test("ACC-SYNC-001 bounded model check: idempotency holds over the full space", () => {
  const r = modelCheck(syncSystem());
  assert.equal(r.invariantHeld, true);
  assert.ok(r.distinct > 50, "state space should cover concurrent completions");
});

test("ACC-SYNC-001 mutation: dropping the idempotency-key comparison is caught", () => {
  // Relaxing the key comparison in the invariant makes attempts with different
  // keys count as "same context" — states where they legitimately differ now
  // violate, which is exactly the counterexample the mutated invariant must show.
  const r = modelCheck(syncSystem({ mutation: "drop-key-compare" }));
  assert.equal(r.invariantHeld, false);
  const ce = normalizeSyncCounterexample(r.counterexample);
  assert.equal(ce.ruleId, "ACC-SYNC-001");
  assert.equal(ce.generatedSelector, "IdempotentExternalSync");
});

test("ACC-SYNC-001 mutation: dropping the tenant comparison is caught", () => {
  const r = modelCheck(syncSystem({ mutation: "drop-tenant-compare" }));
  assert.equal(r.invariantHeld, false);
});

test("ACC-SYNC-001 mutation: dropping the provider comparison is caught", () => {
  const r = modelCheck(syncSystem({ mutation: "drop-provider-compare" }));
  assert.equal(r.invariantHeld, false);
});

test("ACC-SYNC-001 mutation: dropping the reuse guard allows rebinding — caught", () => {
  // With the guard gone, a second success for the SAME context may pick a
  // different externalId; the (unmutated) invariant must find that trace.
  const r = modelCheck(syncSystem({ mutation: "drop-guard" }));
  assert.equal(r.invariantHeld, false);
  const ce = normalizeSyncCounterexample(r.counterexample);
  assert.ok(ce.trace.length >= 2, "needs two completions to conflict");
});
