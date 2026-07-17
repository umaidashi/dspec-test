# 会計コアドメイン（レビュー用）

> model: `accounting-core` · Core IR digest: `sha256:5495c7c237ad665afc384032751f63f6`

## モデル境界
日本の中小企業向けクラウド会計の最小中核。仕訳の貸借一致、締め済み期間の不変性、テナント分離、外部同期の冪等性のみを対象とする。税法・会計基準・財務諸表生成・税額計算・勘定科目推定・freee/MoneyForward実通信・実DB接続は対象外。

## ドメイン用語
- `accounting.tenant` — テナント
- `accounting.period` — 会計期間
- `accounting.journal-entry` — 仕訳
- `accounting.journal-line` — 仕訳明細
- `accounting.debit` — 借方
- `accounting.credit` — 貸方
- `accounting.period-open` — 期間オープン
- `accounting.period-closed` — 期間クローズ
- `accounting.external-sync` — 外部同期
- `accounting.idempotency-key` — 冪等キー
- `accounting.external-id` — 外部ID
- `accounting.journal-status` — 仕訳ステータス

## エンティティ
### AccountingPeriod (entity) — 会計期間
- id: String
- tenantId: String
- status: enum:open|closed

### JournalEntry (entity) — 仕訳
- id: String
- tenantId: String
- periodId: String
- status: enum:draft|submitted|approved|posted
- lines: list:JournalLine

### JournalLine (value) — 仕訳明細
- id: String
- journalEntryId: String
- tenantId: String
- side: enum:debit|credit
- amount: Int

### ExternalSyncRecord (entity) — 外部同期記録
- id: String
- tenantId: String
- provider: String
- idempotencyKey: String
- status: enum:pending|sending|success|failed|unknown
- externalId: String

## 業務ルール
### ACC-JOURNAL-001 — 仕訳の貸借一致
- **仕様**: 承認済みまたは記帳済みの仕訳は、借方合計と貸方合計が一致しなければならない。
- **分類**: `numeric-invariant`
- **主要検証戦略**: `lean` (backend: `lean`)
- **補助検証**: `property-test`, `implementation-test`
- **必要な保証**: `reference`, `executed`, `mutation-tested`, `proved`
- **達成した保証**: `reference`, `executed`, `mutation-tested`, `proved`
- **Clause**:
  - `must[0]` (must, invariant): `implies(isApprovedOrPosted(entry), eq(debitTotal(entry), creditTotal(entry)))` — 承認済み/記帳済みは貸借一致
  - `must[1]` (must, invariant): `implies(forall(e, entries, balanced(e)), eq(sum(entries, debitTotal), sum(entries, creditTotal)))` — 貸借一致仕訳の集計は試算表でも一致
- **検証対象**:
  - `lean` → `journal_balanced` covers `must[0]` (clause)
  - `lean` → `trial_balance_preserved` covers `must[1]` (clause)
  - `property` → `prop_balanced` covers `must[0]` (clause)
- **実装参照**:
  - implementation: `src/domain/journal.mjs#debitTotal`
  - test: `test/journal.test.mjs#ACC-JOURNAL-001`
- **証明/検査される範囲**: 有限リストの金額合計の等式、および貸借一致仕訳集合の集計保存。
- **証明/検査されない範囲**: DBから正しい明細が読めること・通貨/端数処理・外部システムの金額表現・UI入力変換の正しさ。

### ACC-PERIOD-003 — 締め済み期間の変更禁止
- **仕様**: 締め済み会計期間に属する仕訳は、作成・更新・削除できない。
- **分類**: `state-transition`
- **主要検証戦略**: `tla` (backend: `tla`)
- **補助検証**: `implementation-test`
- **必要な保証**: `reference`, `executed`, `bounded`
- **達成した保証**: `reference`, `executed`, `bounded`
- **Clause**:
  - `must[0]` (must, transition): `implies(periodClosed(periodOf(entry)), and(not(create(entry)), and(not(update(entry)), not(delete(entry)))))` — 締め済みなら作成/更新/削除不可
- **検証対象**:
  - `tla` → `ClosedPeriodImmutable` covers `must[0]` (clause)
  - `implementation` → `period-guard` covers `must[0]` (rule)
- **実装参照**:
  - implementation: `src/domain/period.mjs#assertMutable`
  - test: `test/period.test.mjs#ACC-PERIOD-003`
- **証明/検査される範囲**: 有限scope上で、締め後に作成/更新/削除へ到達する状態遷移が存在しないこと。
- **証明/検査されない範囲**: 無限状態空間全体・実DBのトランザクション分離・並行制御実装の正しさ。

### ACC-TENANT-001 — テナント間参照禁止
- **仕様**: 仕訳・仕訳明細・会計期間・外部同期記録は同じテナントに属さなければならない。
- **分類**: `relational-invariant`
- **主要検証戦略**: `alloy` (backend: `alloy`)
- **補助検証**: `implementation-test`
- **必要な保証**: `reference`, `executed`, `bounded`
- **達成した保証**: `reference`, `executed`, `bounded`
- **Clause**:
  - `must[0]` (must, relation): `implies(eq(entry.periodId, period.id), eq(entry.tenantId, period.tenantId))` — 仕訳と期間のテナント一致
  - `must[1]` (must, relation): `implies(eq(line.journalEntryId, entry.id), eq(line.tenantId, entry.tenantId))` — 明細と仕訳のテナント一致
  - `must[2]` (must, relation): `implies(eq(sync.journalEntryId, entry.id), eq(sync.tenantId, entry.tenantId))` — 同期記録と仕訳のテナント一致
- **検証対象**:
  - `alloy` → `TenantIsolation` covers `must[0]`, `must[1]`, `must[2]` (clause)
  - `implementation` → `repository-tenant-scope` covers `must[1]` (rule)
- **実装参照**:
  - implementation: `src/domain/tenant.mjs#scopedQuery`
  - db-constraint: `src/domain/tenant.mjs#tenant_fk`
  - test: `test/tenant.test.mjs#ACC-TENANT-001`
- **証明/検査される範囲**: 有限scope上で、別テナントの期間/仕訳を参照する仕訳/明細/同期記録が存在しないこと。
- **証明/検査されない範囲**: 無限個のインスタンス・実DBの外部キー実装・アプリ層の権限チェック全体。

### ACC-SYNC-001 — 外部同期の冪等性
- **仕様**: 同一テナント・同一provider・同一冪等キーで成功した同期は、同一のexternalIdを指さなければならない。
- **分類**: `temporal-property`
- **主要検証戦略**: `tla` (backend: `tla`)
- **補助検証**: `implementation-test`
- **必要な保証**: `reference`, `executed`, `bounded`
- **達成した保証**: `reference`, `executed`, `bounded`
- **Clause**:
  - `must[0]` (must, temporal-property): `implies(and(success(a), and(success(b), and(eq(a.tenantId, b.tenantId), and(eq(a.provider, b.provider), eq(a.idempotencyKey, b.idempotencyKey))))), eq(a.externalId, b.externalId))` — 同一キー成功は同一externalId
- **検証対象**:
  - `tla` → `IdempotentExternalSync` covers `must[0]` (clause)
  - `implementation` → `sync-idempotency` covers `must[0]` (rule)
- **実装参照**:
  - implementation: `src/domain/sync.mjs#completeSync`
  - db-constraint: `src/domain/sync.mjs#sync_unique`
  - test: `test/sync.test.mjs#ACC-SYNC-001`
- **証明/検査される範囲**: 有限scope上で、同一(tenant,provider,key)の成功が異なるexternalIdを持つ状態へ到達しないこと。
- **証明/検査されない範囲**: 実外部APIの動作・ネットワーク分断の全パターン・無限リトライ空間。

## 非目標
- 日本の税法全体 / entire Japanese tax law
- 会計基準全体 / entire accounting standards
- 財務諸表生成 / financial statement generation
- 税額計算全般 / general tax computation
- 勘定科目自動推定 / automatic account inference
- freee / Money Forward API 実通信 / real external API traffic
- 実運用DB接続 / production DB connectivity
