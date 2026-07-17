# Accounting domain — design & verification guide

対象: 日本の中小企業向けクラウド会計の最小中核（`examples/accounting-core.pkl`）。
このドキュメントは、なぜこの構造なのか・各バックエンドが何を保証し何を保証しないかを説明する。

## 1. なぜPklを上位仕様にしたか

- 業務ルールはドメインエキスパート・実装者・LLMが**共同編集**する。Pklは型付き
  かつ宣言的で、日本語ラベル・説明・実装参照を一箇所に持てる。
- 形式手法の言語（Lean/TLA+/Alloy）はいずれも「人間向け仕様の正本」には硬すぎ、
  かつ互いに翻訳できない。上位に中立な authoring source を置き、そこから投影する。
- ただし **Pklは証明系ではない**。Pklの型検査が通ることは何の保証でもない。
  保証はすべて下流の検証機とevidenceが与える。

## 2. なぜLeanを唯一の正本にしなかったか

- Leanは純粋計算の証明には最適だが、締め処理の並行実行順序（TLA+の領分）や
  有限構造上の禁止パターン探索（Alloyの領分）を書くのは可能でも不自然で、
  維持コストが高い。
- 「すべてをLeanへ」は、証明されない大量のLean定義（=実質ただのコード）を生み、
  `proved` の意味を希釈する。証明した箇所と書いただけの箇所の区別が崩れる。
- 各ルールは性質ごとに最も安い十分な検証器へ割り当てる（§5）。

## 3. PklとCore IRの関係

Pklモデルは `src/core/ir.mjs` で **Canonical Core IR** に正規化される。
バックエンドはPklを直接解釈しない。IRは:

- ルールごとに clause 式AST・自由変数・IR種別（invariant/relation/transition/…）を持つ
- clause 式の演算子ごとに backend applicability（semantic/structural/textual/unmapped）を付す
- 内容に対して安定な digest を持つ（evidence の失効判定に使う）

意味論の定義は `docs/semantic-model.md`。

## 4. Lean、TLA+、Alloyの責務

| バックエンド | 責務 | 会計MVPでの担当 |
|---|---|---|
| Lean | 純粋な会計計算・数学的不変条件・集計の性質保存 | ACC-JOURNAL-001 |
| TLA+ | 状態遷移・並行実行・リトライ・締め処理・同期プロトコル | ACC-PERIOD-003, ACC-SYNC-001 |
| Alloy | 関係構造・所有・テナント分離・有限構造上の禁止パターン | ACC-TENANT-001 |
| 通常テスト | API/DB結合・入力検証・実装との突き合わせ | 全ルールの補助 |

同じルールを複数バックエンドへ**重複投影しない**。補助検証（property test、
実装テスト）は主要検証と別の保証レベルを担うため重複ではない。

## 5. 各Ruleのbackend割り当て

| Rule | 分類 | 主要戦略 | 補助 | 必要保証 |
|---|---|---|---|---|
| ACC-JOURNAL-001 仕訳の貸借一致 | numeric-invariant | **Lean** | property / impl test | reference, executed, mutation-tested, **proved** |
| ACC-PERIOD-003 締め済み期間の変更禁止 | state-transition | **TLA+** | impl test | reference, executed, **bounded** |
| ACC-TENANT-001 テナント間参照禁止 | relational-invariant | **Alloy** | impl test / DB constraint | reference, executed, **bounded** |
| ACC-SYNC-001 外部同期の冪等性 | temporal-property | **TLA+** | impl test / DB unique | reference, executed, **bounded** |

## 6. 各backendで何を保証するか

- **Lean (ACC-JOURNAL-001)**: 有限リスト上の借方合計=貸方合計の等式、および
  「全仕訳がbalancedなら試算表もbalanced」の集計保存（リスト帰納法による定理
  `trial_balance_preserved`）。
- **TLA+ (ACC-PERIOD-003)**: 有限scope（version上限2、4操作）で、close後に
  作成/更新/削除へ到達する遷移が存在しないこと。
- **TLA+ (ACC-SYNC-001)**: 有限scope（5コンテキスト×2 externalId）で、同一
  (tenant, provider, idempotencyKey) の成功が異なるexternalIdを持つ状態に到達
  しないこと。並行完了・timeout・再試行・照会復帰を含む。
- **Alloy (ACC-TENANT-001)**: 有限scope（各シグネチャ4以下）で、別テナントの
  period/entryを参照する entry/line/sync が存在しないこと。

## 7. 各backendで何を保証しないか

- **Lean**: DBから正しい明細が読み出されること、通貨・端数処理、外部システムの
  金額表現、UI入力変換。証明対象は自前定義の `debitTotal`/`creditTotal` であり、
  実装コードそのものではない（実装との対応はproperty test+mutationが担う）。
- **TLA+**: 無限状態空間、実DBのトランザクション分離、ネットワーク分断の全パターン、
  実外部APIの挙動。モデル検査成功は現実の運用の保証ではない。
- **Alloy**: scope外の構造、実DB外部キーの実装、アプリ層認可の全体。
- **共通**: コンパイル成功・型検査成功は保証ではない。evidenceの
  `assuranceKind` と `evidenceKind` だけが主張の単位である。

## 8. evidenceの見方

`generated/evidence/evidence.json` の各レコード:

```jsonc
{
  "ruleId": "ACC-PERIOD-003",
  "clauseSelector": "must[0]",
  "generatedSelector": "ClosedPeriodImmutable",   // 生成物側の定理/不変条件名
  "backend": "tla",
  "tool": "dspec/tlc-bmc", "toolVersion": "1",
  "result": "pass",
  "assuranceKind": "bounded",                      // reference|executed|mutation-tested|bounded|proved
  "evidenceKind": "model-check",                   // 保証レベルの正当な根拠種別
  "scope": { "versionCap": 2, "actions": [...] },  // boundedの有限範囲
  "bounds": { "states": 15, "distinct": 15, "depth": 4 },
  "modelDigest": "sha256:…", "coreIRDigest": "sha256:…",
  "sourceMapDigest": "sha256:…", "artifactDigest": "sha256:…"
}
```

- digest 4種のどれかが現在の成果物と一致しなければ `dspec evidence verify` が
  `stale` を報告する。**古い成功を現在の証拠として扱わない。**
- `proved` は定理名 (`theoremName`) と証明器を伴う。`bounded` は scope/bounds を伴う。

## 9. 反例の読み方

バックエンドの生の反例はRule単位へ正規化される（`src/verify/counterexample.mjs`）:

```json
{
  "ruleId": "ACC-PERIOD-003",
  "selector": "must[0]",
  "backend": "tla",
  "generatedSelector": "ClosedPeriodImmutable",
  "assurance": "bounded",
  "message": "締め済み期間で仕訳の作成/更新/削除が可能な状態遷移が見つかりました",
  "trace": ["CreateJournal", "ClosePeriod", "UpdateJournal"]
}
```

`trace` は初期状態からの操作列。`generatedSelector` から source map
(`generated/accounting/source-map.json`) を引くと元のPkl Rule/Clauseへ戻れる。

## 10. Rule追加手順

1. `examples/accounting-core.pkl` に `Rule` を追加（安定ID、日英ラベル、分類、
   主要戦略、必要保証、clause AST、implementation refs）。
2. `node src/cli.mjs check` — 型検査とrouting（applicability）を通す。
3. 実装とテストを書き、`implementationRefs` のanchorを一致させる（drift対象）。
4. 主要戦略のバックエンド成果物を emitter に接続し、`generatedSelector` を
   `checkTargets` にpinする。
5. mutation を `fixtures/mutations/catalog.json` に追加し、検出されることを確認。
6. `node src/cli.mjs generate` → `coverage` → `evidence verify` を通す。

## 11. 新しいbackendを追加する手順

1. `src/core/applicability.mjs` に演算子ごとの applicability 行を追加する。
   **全演算子を一度に semantic にしないこと** — 表現できないものは `unmapped` と
   宣言する。
2. `src/backends/<name>.mjs` にemitterを書き、generated selector一覧を返す。
3. 検証機（実ツール呼び出し、なければ同等の有限検査）を `src/verify/` に追加し、
   `ASSURANCE_EVIDENCE_KIND` に整合する evidenceKind を返す。
4. drift / verify-generated / evidence へ自動的に載る（emitterのdigestとselector
   経由）。failure test を追加する。

## 12. 過剰な多重形式化を避ける基準

新しい形式化を足す前に、次のすべてに **yes** と答えられること:

1. 既存の主要検証戦略では表現できない性質か（分類が変わるか）。
2. その保証レベル（bounded/proved）を本当に要求するリスクがあるか。
3. 反例・定理をRuleへ正規化して返せるか（source map接続が可能か）。
4. 維持コスト（drift・evidence・mutation）を払う価値があるか。

「同じルールを別言語でも書ける」は理由にならない。1ルール=1主要戦略が原則。
補助は property / implementation test で足りる場合がほとんどである。
