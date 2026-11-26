export type LivePosition = {
  id: number;
  deviceId: number;
  fixTime: string;
  speed: number;
  attributes?: Record<string, unknown>;
};

export type LivePositionStatus =
  | "no-data"
  | "stale"
  | "unknown"
  | "moving"
  | "stationary";

export const MAX_POSITION_AGE_MS = 10 * 60 * 1000;
export const MAX_STATIONARY_SPEED_KNOTS = 0.5;

export function isValidCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function getLivePositionStatus(
  position: LivePosition | null | undefined,
  now = Date.now(),
): LivePositionStatus {
  if (!position) return "no-data";

  const fixTime = Date.parse(position.fixTime);
  const age = now - fixTime;
  if (!Number.isFinite(fixTime) || age < 0 || age > MAX_POSITION_AGE_MS) {
    return "stale";
  }
  if (
    typeof position.speed !== "number" ||
    !Number.isFinite(position.speed) ||
    position.speed < 0
  ) {
    return "unknown";
  }
  if (
    position.speed > MAX_STATIONARY_SPEED_KNOTS ||
    position.attributes?.motion === true ||
    position.attributes?.motion === "true"
  ) {
    return "moving";
  }
  return "stationary";
}

export function mergeLatestPositions<T extends LivePosition>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const latestByDevice = new Map<number, T>();

  for (const position of [...current, ...incoming]) {
    if (!Number.isSafeInteger(position.deviceId) || position.deviceId <= 0) {
      continue;
    }

    const fixTime = Date.parse(position.fixTime);
    if (!Number.isFinite(fixTime)) continue;

    const previous = latestByDevice.get(position.deviceId);
    if (!previous) {
      latestByDevice.set(position.deviceId, position);
      continue;
    }

    const previousFixTime = Date.parse(previous.fixTime);
    if (
      fixTime > previousFixTime ||
      (fixTime === previousFixTime && position.id >= previous.id)
    ) {
      latestByDevice.set(position.deviceId, position);
    }
  }

  return Array.from(latestByDevice.values()).sort(
    (a, b) => Date.parse(b.fixTime) - Date.parse(a.fixTime),
  );
}
