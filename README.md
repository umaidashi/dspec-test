# dspec — Accounting Domain MVP

Pkl-authored domain specifications, normalized to a Canonical Core IR and routed
to the verification backend that owns each rule's property class:

```text
Pkl domain specification
        ↓
Canonical Core IR
        ↓
Verification routing
        ├─ Lean            pure accounting math (balance, aggregation)
        ├─ TLA+            state transitions, retries, closing, sync protocol
        ├─ Alloy           relational structure, tenant isolation
        ├─ property tests  generated-data checks against the implementation
        └─ implementation checks  scenario tests against src/domain/
```

One rule → one primary strategy. The same rule is never redundantly projected
onto every formal backend, and a backend that cannot carry a clause's meaning
(`unmapped`) is refused by routing rather than silently approximated.

## The model

`examples/accounting-core.pkl` — a minimal cloud-accounting core for Japanese
SMBs (Tenant / AccountingPeriod / JournalEntry / JournalLine /
ExternalSyncRecord) with four rules:

| Rule | 内容 | Primary | Required assurance |
|---|---|---|---|
| ACC-JOURNAL-001 | 仕訳の貸借一致 | Lean | proved (+ mutation-tested) |
| ACC-PERIOD-003 | 締め済み期間の変更禁止 | TLA+ | bounded |
| ACC-TENANT-001 | テナント間参照禁止 | Alloy | bounded |
| ACC-SYNC-001 | 外部同期の冪等性 | TLA+ | bounded |

## Commands

```sh
pnpm test                                                  # all unit/property/failure tests

node src/cli.mjs check examples/accounting-core.pkl        # types + routing + verifiers
node src/cli.mjs drift examples/accounting-core.pkl        # spec ↔ code/artifact drift
node src/cli.mjs coverage examples/accounting-core.pkl     # required assurance coverage
node src/cli.mjs domain-coverage examples/accounting-core.pkl

node src/cli.mjs render --locale ja examples/accounting-core.pkl
node src/cli.mjs render --locale en examples/accounting-core.pkl

node src/cli.mjs emit lean examples/accounting-core.pkl
node src/cli.mjs emit tla examples/accounting-core.pkl
node src/cli.mjs emit alloy examples/accounting-core.pkl
node src/cli.mjs emit source-map examples/accounting-core.pkl

node src/cli.mjs generate examples/accounting-core.pkl     # all artifacts + source map + evidence
node src/cli.mjs generated check examples/accounting-core.pkl
node src/cli.mjs verify-generated --json examples/accounting-core.pkl

node src/cli.mjs evidence create examples/accounting-core.pkl
node src/cli.mjs evidence verify examples/accounting-core.pkl
node src/cli.mjs mutation                                  # run the mutation catalog
node src/cli.mjs applicability examples/accounting-core.pkl
```

## Toolchain note (honest assurance without external provers)

- **Pkl is real**: the devDependency `@pkl-community/pkl` provides the official
  Pkl evaluator, and the loader uses it whenever present (`pnpm install` is
  enough). Without it, a constrained-subset parser (`src/core/pkl.mjs`) takes
  over; both evaluators are pinned to produce identical model digests
  (`test/pkl-evaluator.test.mjs`), so evidence validity does not depend on
  which one loaded the model.

`lean`, `tlc`, and Alloy are not installable in this sandbox (their
distribution channels — GitHub Releases, Maven Central — are blocked), so:
- The emitted Lean / TLA+ / Alloy sources (`generated/`) are real and intended
  for those tools. Verification falls back to built-in checkers that discharge
  the *same* obligations at the *same* assurance level:
  - `proved` — a linear-integer-equality decision procedure
    (`src/verify/lean-check.mjs`) discharges the balance obligations; when
    `lake` is installed it compiles the emitted inductive proof instead.
  - `bounded` — an exhaustive explicit-state BFS (`src/verify/model-check.mjs`)
    and a finite-scope relational enumerator (`src/verify/relational-check.mjs`)
    over the same state spaces the TLA+/Alloy artifacts define, with states /
    depth / scope recorded in evidence.
- Nothing is ever recorded above what was actually checked: compilation alone
  is not `proved`, a unit test is not `bounded`, and stale evidence fails
  `evidence verify`.

## Docs

- `docs/semantic-model.md` — Core IR node kinds, operators, applicability, assurance ladder
- `docs/accounting-domain.md` — why Pkl on top, backend responsibilities, how to read evidence & counterexamples, how to add rules/backends
- `generated/examples/{ja,en}/accounting-core.md` — bilingual review documents
