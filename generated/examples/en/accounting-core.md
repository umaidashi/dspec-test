# Accounting Core Domain (review)

> model: `accounting-core` · Core IR digest: `sha256:5495c7c237ad665afc384032751f63f6`

## Model boundary
Minimal core of cloud accounting for Japanese SMBs. Covers only journal balance, closed-period immutability, tenant isolation, and external-sync idempotency. Tax law, accounting standards, statement generation, tax computation, account inference, real freee/MoneyForward calls, and real DB connections are out of scope.

## Domain vocabulary
- `accounting.tenant` — Tenant
- `accounting.period` — Accounting period
- `accounting.journal-entry` — Journal entry
- `accounting.journal-line` — Journal line
- `accounting.debit` — Debit
- `accounting.credit` — Credit
- `accounting.period-open` — Period open
- `accounting.period-closed` — Period closed
- `accounting.external-sync` — External sync
- `accounting.idempotency-key` — Idempotency key
- `accounting.external-id` — External id
- `accounting.journal-status` — Journal status

## Entities
### AccountingPeriod (entity) — Accounting period
- id: String
- tenantId: String
- status: enum:open|closed

### JournalEntry (entity) — Journal entry
- id: String
- tenantId: String
- periodId: String
- status: enum:draft|submitted|approved|posted
- lines: list:JournalLine

### JournalLine (value) — Journal line
- id: String
- journalEntryId: String
- tenantId: String
- side: enum:debit|credit
- amount: Int

### ExternalSyncRecord (entity) — External sync record
- id: String
- tenantId: String
- provider: String
- idempotencyKey: String
- status: enum:pending|sending|success|failed|unknown
- externalId: String

## Rules
### ACC-JOURNAL-001 — Journal debit/credit balance
- **Spec**: An approved or posted journal entry must have equal debit and credit totals.
- **Classification**: `numeric-invariant`
- **Primary strategy**: `lean` (backend: `lean`)
- **Auxiliary**: `property-test`, `implementation-test`
- **Required assurance**: `reference`, `executed`, `mutation-tested`, `proved`
- **Achieved assurance**: `reference`, `executed`, `mutation-tested`, `proved`
- **Clauses**:
  - `must[0]` (must, invariant): `implies(isApprovedOrPosted(entry), eq(debitTotal(entry), creditTotal(entry)))` — approved/posted entries balance
  - `must[1]` (must, invariant): `implies(forall(e, entries, balanced(e)), eq(sum(entries, debitTotal), sum(entries, creditTotal)))` — aggregation of balanced entries preserves balance
- **Check targets**:
  - `lean` → `journal_balanced` covers `must[0]` (clause)
  - `lean` → `trial_balance_preserved` covers `must[1]` (clause)
  - `property` → `prop_balanced` covers `must[0]` (clause)
- **Implementation refs**:
  - implementation: `src/domain/journal.mjs#debitTotal`
  - test: `test/journal.test.mjs#ACC-JOURNAL-001`
- **What is proved / checked**: Equality of finite line-amount sums, and aggregation preservation over balanced entries.
- **What is NOT proved / checked**: That correct lines are read from the DB, currency/rounding, external money representations, or UI input conversion.

### ACC-PERIOD-003 — Closed period is immutable
- **Spec**: Journal entries in a closed accounting period cannot be created, updated, or deleted.
- **Classification**: `state-transition`
- **Primary strategy**: `tla` (backend: `tla`)
- **Auxiliary**: `implementation-test`
- **Required assurance**: `reference`, `executed`, `bounded`
- **Achieved assurance**: `reference`, `executed`, `bounded`
- **Clauses**:
  - `must[0]` (must, transition): `implies(periodClosed(periodOf(entry)), and(not(create(entry)), and(not(update(entry)), not(delete(entry)))))` — closed forbids create/update/delete
- **Check targets**:
  - `tla` → `ClosedPeriodImmutable` covers `must[0]` (clause)
  - `implementation` → `period-guard` covers `must[0]` (rule)
- **Implementation refs**:
  - implementation: `src/domain/period.mjs#assertMutable`
  - test: `test/period.test.mjs#ACC-PERIOD-003`
- **What is proved / checked**: That over a finite scope no state transition reaches create/update/delete after close.
- **What is NOT proved / checked**: The full infinite state space, real DB transaction isolation, or concurrency-control implementation.

### ACC-TENANT-001 — No cross-tenant references
- **Spec**: Journal entries, lines, periods, and external-sync records must belong to the same tenant.
- **Classification**: `relational-invariant`
- **Primary strategy**: `alloy` (backend: `alloy`)
- **Auxiliary**: `implementation-test`
- **Required assurance**: `reference`, `executed`, `bounded`
- **Achieved assurance**: `reference`, `executed`, `bounded`
- **Clauses**:
  - `must[0]` (must, relation): `implies(eq(entry.periodId, period.id), eq(entry.tenantId, period.tenantId))` — entry/period tenant match
  - `must[1]` (must, relation): `implies(eq(line.journalEntryId, entry.id), eq(line.tenantId, entry.tenantId))` — line/entry tenant match
  - `must[2]` (must, relation): `implies(eq(sync.journalEntryId, entry.id), eq(sync.tenantId, entry.tenantId))` — sync/entry tenant match
- **Check targets**:
  - `alloy` → `TenantIsolation` covers `must[0]`, `must[1]`, `must[2]` (clause)
  - `implementation` → `repository-tenant-scope` covers `must[1]` (rule)
- **Implementation refs**:
  - implementation: `src/domain/tenant.mjs#scopedQuery`
  - db-constraint: `src/domain/tenant.mjs#tenant_fk`
  - test: `test/tenant.test.mjs#ACC-TENANT-001`
- **What is proved / checked**: That over a finite scope no entry/line/sync references a period/entry of another tenant.
- **What is NOT proved / checked**: Unbounded instances, the real DB foreign-key implementation, or the full app-layer authorization.

### ACC-SYNC-001 — External sync idempotency
- **Spec**: Successful syncs with the same tenant, provider, and idempotency key must point to the same externalId.
- **Classification**: `temporal-property`
- **Primary strategy**: `tla` (backend: `tla`)
- **Auxiliary**: `implementation-test`
- **Required assurance**: `reference`, `executed`, `bounded`
- **Achieved assurance**: `reference`, `executed`, `bounded`
- **Clauses**:
  - `must[0]` (must, temporal-property): `implies(and(success(a), and(success(b), and(eq(a.tenantId, b.tenantId), and(eq(a.provider, b.provider), eq(a.idempotencyKey, b.idempotencyKey))))), eq(a.externalId, b.externalId))` — same key success implies same externalId
- **Check targets**:
  - `tla` → `IdempotentExternalSync` covers `must[0]` (clause)
  - `implementation` → `sync-idempotency` covers `must[0]` (rule)
- **Implementation refs**:
  - implementation: `src/domain/sync.mjs#completeSync`
  - db-constraint: `src/domain/sync.mjs#sync_unique`
  - test: `test/sync.test.mjs#ACC-SYNC-001`
- **What is proved / checked**: That over a finite scope no reachable state gives two successes for the same (tenant,provider,key) different externalIds.
- **What is NOT proved / checked**: Real external API behavior, all network-partition patterns, or the unbounded retry space.

## Non-goals
- 日本の税法全体 / entire Japanese tax law
- 会計基準全体 / entire accounting standards
- 財務諸表生成 / financial statement generation
- 税額計算全般 / general tax computation
- 勘定科目自動推定 / automatic account inference
- freee / Money Forward API 実通信 / real external API traffic
- 実運用DB接続 / production DB connectivity
