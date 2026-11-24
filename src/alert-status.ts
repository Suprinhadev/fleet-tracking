export class AlertStoreError extends Error {
  constructor(
    readonly statusCode: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "AlertStoreError";
  }
}

export function getAlertStatusConflict(
  currentStatus: string,
  requestedStatus: "acknowledged" | "resolved",
): string | null {
  if (currentStatus === "resolved" && requestedStatus !== "resolved") {
    return "Um alerta resolvido não pode ser reaberto.";
  }
  return null;
}
