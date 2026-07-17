# dspec semantic model — Canonical Core IR

This document defines what the Core IR *means*, so that every backend projects
from a single explicit semantics instead of privately reinterpreting Pkl.

## Pipeline

```text
Pkl domain specification    (examples/*.pkl — authoring source)
        ↓  parse + type check         (src/core/pkl.mjs, src/core/schema.mjs)
Canonical Core IR           (src/core/ir.mjs)
        ↓  verification routing       (classification → primary strategy)
        ├─ Lean               (src/backends/lean.mjs)
        ├─ TLA+               (src/backends/tla.mjs)
        ├─ Alloy              (src/backends/alloy.mjs)
        ├─ property tests     (src/verify/property-run.mjs)
        └─ implementation checks (src/verify/impl-check.mjs)
```

Pkl is a convenient authoring source, **not** a proof system. Backends never
read Pkl; they read the IR. The IR is normalized: object-key order, comments,
and authoring style do not affect its digest.

## IR node kinds

| Kind | Meaning | Where |
|---|---|---|
| entity | identity-bearing domain object | `domainTypes[kind=entity]` |
| value | immutable value object | `domainTypes[kind=value]` |
| state | enumerated status field | `enum:` field types |
| operation | named state-changing action | TLA+ actions (CreateJournal, …) |
| predicate | boolean function over domain values | clause `irKind=predicate` |
| invariant | predicate that must hold in every state | clauses of pure/numeric invariants |
| relation | constraint over object references | clauses of relational invariants |
| transition | constraint on state changes | clauses of state-transition rules |
| temporal-property | constraint over execution histories | clauses of temporal rules |
| implementation-reference | anchor into code/tests | `implementationRefs` |
| verification-target | obligation bound to one backend | `checkTargets` |

## Expression operators

Clause ASTs use: `atom` (refs/literals), `not`, `and`, `or`, `implies`, `eq`,
`neq`, `forall`, `exists`, `sum`, `add`, `sub`, `gt`, `gte`, `lt`, `lte`, plus
opaque domain functions (`debitTotal`, `periodClosed`, …).

Integer semantics are mathematical integers (Lean `Nat` for amounts; JS numbers
in tests are safe integers — amounts are validated non-negative and bounded).

## Backend applicability

Every operator declares per backend one of:

- `semantic` — projected with its full intended meaning
- `structural` — shape representable, meaning only partially carried
- `textual` — appears only as annotation, not machine-checked
- `unmapped` — not representable; **emitting anyway would change meaning**

Key rows (full table in `src/core/applicability.mjs`):

| op | Lean | TLA+ | Alloy | property |
|---|---|---|---|---|
| eq | semantic | semantic | semantic | semantic |
| implies | semantic | semantic | semantic | semantic |
| sum | semantic | structural | **unmapped** | semantic |
| forall | semantic | structural | semantic | structural |
| gt/lt | semantic | semantic | structural | semantic |

Routing refuses to bind a rule to a backend that is `unmapped`/`textual` for
any operator in a covered clause (`dspec check` fails; `dspec coverage` reports
`over-claim`). This is the mechanism that prevents multi-formalization by
default: a rule has **one** primary strategy, and only backends that can carry
the meaning are eligible.

## Assurance ladder

`reference < executed < mutation-tested < bounded < proved`

| Level | Claim | Legitimate evidence kinds |
|---|---|---|
| reference | spec points at real code/tests | source-link |
| executed | the check ran and passed now | test-run, property-run |
| mutation-tested | injected faults were caught | mutation-run |
| bounded | exhaustive within a declared finite scope | model-check, relational-check |
| proved | machine-checked for all cases | proof, decision-procedure |

Coverage rejects satisfying a level with the wrong evidence kind: a green unit
test can never satisfy `bounded`; a successful compile alone never satisfies
`proved` (the evidence must name the discharged theorem, and the checker that
discharged it).

## Digests and staleness

Evidence records bind: model digest, Core IR digest, source-map digest, and
generated-artifact digest. `dspec evidence verify` recomputes all four; any
mismatch marks the record `stale`. Old green results never vouch for current
code.
