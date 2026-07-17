// Counterexample normalization.
//
// Raw traces from the bounded model checker / relational checker are lifted back
// to a human-readable, Rule-anchored JSON shape (see task examples), so a
// backend failure is reported in domain terms, not backend internals.

export function normalizePeriodCounterexample(ce, { assurance = "bounded" } = {}) {
  const trace = (ce || []).map((step) => step.via).filter((v) => v !== "Init");
  return {
    ruleId: "ACC-PERIOD-003",
    selector: "must[0]",
    backend: "tla",
    generatedSelector: "ClosedPeriodImmutable",
    assurance,
    message: "締め済み期間で仕訳の作成/更新/削除が可能な状態遷移が見つかりました",
    messageEn: "Found a state transition that mutates a journal in a closed period",
    trace,
  };
}

export function normalizeSyncCounterexample(ce, { assurance = "bounded" } = {}) {
  const trace = (ce || []).map((step) => step.via).filter((v) => v !== "Init");
  return {
    ruleId: "ACC-SYNC-001",
    selector: "must[0]",
    backend: "tla",
    generatedSelector: "IdempotentExternalSync",
    assurance,
    message: "同一の冪等性キーに異なるexternalIdが割り当てられました",
    messageEn: "Two successful syncs for the same idempotency context received different externalIds",
    trace,
  };
}

export function normalizeTenantCounterexample(ce, scope, { assurance = "bounded" } = {}) {
  return {
    ruleId: "ACC-TENANT-001",
    selector: "must[0]",
    backend: "alloy",
    generatedSelector: "TenantIsolation",
    assurance,
    message: "別テナントのエンティティを参照する構造が見つかりました",
    messageEn: "Found a structure referencing an entity of another tenant",
    scope,
    witness: ce,
  };
}
