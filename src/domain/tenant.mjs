// ACC-TENANT-001 implementation. Anchors watched by drift: scopedQuery, tenant_fk.

export class CrossTenantError extends Error {}

/**
 * scopedQuery — a repository read that REQUIRES a tenant scope. Fetching by id
 * alone is rejected; every row is checked to belong to the requested tenant.
 */
export function scopedQuery(rows, { tenantId }) {
  if (tenantId == null) throw new CrossTenantError("tenant scope is required for repository queries");
  return rows.filter((r) => r.tenantId === tenantId);
}

/** tenant_fk — the invariant a DB foreign key would enforce, checked in code. */
export function tenant_fk(child, parent) {
  return child.tenantId === parent.tenantId;
}

/** Reject a journal whose period belongs to another tenant. */
export function assertSameTenantPeriod(entry, period) {
  if (!tenant_fk(entry, period)) throw new CrossTenantError("entry/period tenant mismatch");
}
