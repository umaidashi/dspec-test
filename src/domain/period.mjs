// ACC-PERIOD-003 implementation. Anchor watched by drift: assertMutable.

export class ClosedPeriodError extends Error {}

/** Throws if the period the entry belongs to is closed. */
export function assertMutable(period) {
  if (period.status === "closed") {
    throw new ClosedPeriodError(`period ${period.id} is closed and immutable`);
  }
}

export function createJournal(period, entry) {
  assertMutable(period);
  return { ...entry, periodId: period.id, version: 1 };
}

export function updateJournal(period, entry) {
  assertMutable(period);
  return { ...entry, version: (entry.version ?? 1) + 1 };
}

export function deleteJournal(period, entry) {
  assertMutable(period);
  return { ...entry, deleted: true };
}
