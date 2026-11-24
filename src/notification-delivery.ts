export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 5;

const retryDelaysMs = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
];

export function getNotificationDeliveryFailureUpdate(
  attempts: number,
  now: Date,
  error: string,
) {
  const isFinalAttempt = attempts >= MAX_NOTIFICATION_DELIVERY_ATTEMPTS;
  const retryIndex = Math.max(0, Math.min(attempts - 1, retryDelaysMs.length - 1));
  const delayMs = retryDelaysMs[retryIndex];

  return {
    status: isFinalAttempt ? "failed" as const : "pending" as const,
    next_attempt_at: new Date(
      isFinalAttempt ? now.getTime() : now.getTime() + delayMs,
    ).toISOString(),
    lease_expires_at: null,
    last_error: error,
    updated_at: now.toISOString(),
  };
}
