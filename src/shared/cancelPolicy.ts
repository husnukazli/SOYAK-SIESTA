export const FREE_CANCEL_HOURS = 3;
export const LATE_BOOKING_FREE_CANCEL_HOURS = 1;

export interface CancelPolicyStatus {
  isAlreadyStarted: boolean;
  bookedInsideGraceWindow: boolean;
  cutoffHours: number;
  penaltyFreeDeadlineMs: number;
  msUntilPenaltyFreeDeadline: number;
  isLate: boolean;
}

export function getCancelPolicyStatus(
  startMs: number,
  createdAtMs: number | null | undefined,
  nowMs: number
): CancelPolicyStatus {
  const isAlreadyStarted = nowMs >= startMs;
  const bookedInsideGraceWindow =
    typeof createdAtMs === 'number' &&
    Number.isFinite(createdAtMs) &&
    startMs - createdAtMs < FREE_CANCEL_HOURS * 3600_000;
  const cutoffHours = bookedInsideGraceWindow
    ? LATE_BOOKING_FREE_CANCEL_HOURS
    : FREE_CANCEL_HOURS;
  const penaltyFreeDeadlineMs = startMs - cutoffHours * 3600_000;
  const msUntilPenaltyFreeDeadline = penaltyFreeDeadlineMs - nowMs;
  const isLate = !isAlreadyStarted && nowMs > penaltyFreeDeadlineMs;

  return {
    isAlreadyStarted,
    bookedInsideGraceWindow,
    cutoffHours,
    penaltyFreeDeadlineMs,
    msUntilPenaltyFreeDeadline,
    isLate,
  };
}
