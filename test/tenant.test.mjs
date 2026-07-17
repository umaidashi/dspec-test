// ACC-TENANT-001 — no cross-tenant references.
// Anchor watched by drift: ACC-TENANT-001.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTenantImpl } from "../src/verify/impl-check.mjs";
import { relationalCheck } from "../src/verify/relational-check.mjs";
import { normalizeTenantCounterexample } from "../src/verify/counterexample.mjs";
import { scopedQuery, CrossTenantError } from "../src/domain/tenant.mjs";

test("ACC-TENANT-001 implementation scenarios", () => {
  const r = checkTenantImpl();
  for (const c of r.checks) assert.equal(c.pass, true, c.name);
});

test("ACC-TENANT-001 repository queries require a tenant scope", () => {
  assert.throws(() => scopedQuery([{ id: "e1", tenantId: "t1" }], {}), CrossTenantError);
  assert.throws(() => scopedQuery([{ id: "e1", tenantId: "t1" }], { tenantId: null }), CrossTenantError);
});

test("ACC-TENANT-001 bounded relational check: isolation holds in scope", () => {
  const r = relationalCheck();
  assert.equal(r.invariantHeld, true);
  assert.ok(r.structuresEnumerated >= 16, "must enumerate the full bounded universe");
  assert.ok(r.scope.tenants >= 2, "scope must include at least two tenants");
});

test("ACC-TENANT-001 mutation: dropping the tenant condition yields a counterexample", () => {
  const r = relationalCheck({ mutation: "drop-all-tenant" });
  assert.equal(r.invariantHeld, false);
  const ce = normalizeTenantCounterexample(r.counterexample, r.scope);
  assert.equal(ce.ruleId, "ACC-TENANT-001");
  assert.equal(ce.generatedSelector, "TenantIsolation");
});

test("ACC-TENANT-001 mutation: dropping only the period tenant check is caught", () => {
  const r = relationalCheck({ mutation: "drop-period-tenant" });
  assert.equal(r.invariantHeld, false);
  assert.ok(r.counterexample.violations.includes("entry.owner != period.owner"));
});

test("ACC-TENANT-001 mutation: dropping only the sync tenant check is caught", () => {
  const r = relationalCheck({ mutation: "drop-sync-tenant" });
  assert.equal(r.invariantHeld, false);
  assert.ok(r.counterexample.violations.includes("sync.owner != entry.owner"));
});
