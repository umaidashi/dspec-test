// Implementation checks — the "executed" assurance for PERIOD / TENANT / SYNC.
//
// These actually exercise the domain implementations in src/domain/ against the
// scenario lists from the spec. `executed` evidence is recorded only when every
// scenario passes right now, in this run.

import { createJournal, updateJournal, deleteJournal, ClosedPeriodError } from "../domain/period.mjs";
import { scopedQuery, assertSameTenantPeriod, tenant_fk, CrossTenantError } from "../domain/tenant.mjs";
import { completeSync, newStore, SyncConflictError } from "../domain/sync.mjs";

function scenario(name, fn) {
  try {
    const pass = fn() === true;
    return { name, pass };
  } catch (e) {
    return { name, pass: false, error: e.message };
  }
}

const throws = (cls, fn) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof cls;
  }
};

export function checkPeriodImpl() {
  const open = { id: "p1", tenantId: "t1", status: "open" };
  const closed = { id: "p2", tenantId: "t1", status: "closed" };
  const entry = { id: "e1", tenantId: "t1", version: 1, lines: [] };
  const checks = [
    scenario("open allows create", () => createJournal(open, entry).version === 1),
    scenario("open allows update", () => updateJournal(open, entry).version === 2),
    scenario("open allows delete", () => deleteJournal(open, entry).deleted === true),
    scenario("closed forbids create", () => throws(ClosedPeriodError, () => createJournal(closed, entry))),
    scenario("closed forbids update", () => throws(ClosedPeriodError, () => updateJournal(closed, entry))),
    scenario("closed forbids delete", () => throws(ClosedPeriodError, () => deleteJournal(closed, entry))),
    scenario("stale version cannot update after close", () => {
      // update in open period bumps version; after close, even the old version fails
      const stale = { ...entry, version: 1 };
      return throws(ClosedPeriodError, () => updateJournal(closed, stale));
    }),
  ];
  return { ok: checks.every((c) => c.pass), checks };
}

export function checkTenantImpl() {
  const rows = [
    { id: "e1", tenantId: "t1" },
    { id: "e2", tenantId: "t2" },
  ];
  const p1 = { id: "p1", tenantId: "t1" };
  const checks = [
    scenario("scoped query filters other tenants", () => scopedQuery(rows, { tenantId: "t1" }).every((r) => r.tenantId === "t1")),
    scenario("cannot fetch by id alone", () => throws(CrossTenantError, () => scopedQuery(rows, {}))),
    scenario("cross-tenant period rejected", () => throws(CrossTenantError, () => assertSameTenantPeriod({ tenantId: "t2" }, p1))),
    scenario("same-tenant period accepted", () => {
      assertSameTenantPeriod({ tenantId: "t1" }, p1);
      return true;
    }),
    scenario("tenant_fk detects mismatch", () => tenant_fk({ tenantId: "t2" }, p1) === false),
  ];
  return { ok: checks.every((c) => c.pass), checks };
}

export function checkSyncImpl() {
  const checks = [
    scenario("retry with same key converges to same externalId", () => {
      const store = newStore();
      const a = completeSync(store, { tenantId: "t1", provider: "freee", idempotencyKey: "k1", externalId: "x1" });
      const b = completeSync(store, { tenantId: "t1", provider: "freee", idempotencyKey: "k1", externalId: undefined });
      return a.externalId === "x1" && b.externalId === "x1";
    }),
    scenario("same key different externalId conflicts", () => {
      const store = newStore();
      completeSync(store, { tenantId: "t1", provider: "freee", idempotencyKey: "k1", externalId: "x1" });
      return throws(SyncConflictError, () => completeSync(store, { tenantId: "t1", provider: "freee", idempotencyKey: "k1", externalId: "x2" }));
    }),
    scenario("different tenant may reuse key", () => {
      const store = newStore();
      completeSync(store, { tenantId: "t1", provider: "freee", idempotencyKey: "k1", externalId: "x1" });
      const r = completeSync(store, { tenantId: "t2", provider: "freee", idempotencyKey: "k1", externalId: "x9" });
      return r.externalId === "x9";
    }),
    scenario("different provider may reuse key", () => {
      const store = newStore();
      completeSync(store, { tenantId: "t1", provider: "freee", idempotencyKey: "k1", externalId: "x1" });
      const r = completeSync(store, { tenantId: "t1", provider: "moneyforward", idempotencyKey: "k1", externalId: "x9" });
      return r.externalId === "x9";
    }),
  ];
  return { ok: checks.every((c) => c.pass), checks };
}
