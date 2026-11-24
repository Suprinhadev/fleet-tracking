import { knotsToKilometersPerHour } from "./units";

export type TripReport = {
  deviceId: number;
  startTime: string;
  endTime: string;
  distanceMeters: number | null;
  durationMs: number | null;
  averageSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  valid: boolean;
  issue: string | null;
  startPositionId?: number;
  endPositionId?: number;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeTripReports(value: unknown): TripReport[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Traccar returned an invalid trip report.");
  }

  return value.map((item) => {
    const raw = item && typeof item === "object"
      ? item as Record<string, unknown>
      : {};
    const deviceId = finiteNumber(raw.deviceId);
    const startTime = typeof raw.startTime === "string" ? raw.startTime : "";
    const endTime = typeof raw.endTime === "string" ? raw.endTime : "";
    const distanceMeters = finiteNumber(raw.distance);
    const durationMs = finiteNumber(raw.duration);
    const averageSpeedKnots = finiteNumber(raw.averageSpeed);
    const maxSpeedKnots = finiteNumber(raw.maxSpeed);
    let issue: string | null = null;

    if (deviceId === null || deviceId <= 0 ||
        !Number.isFinite(Date.parse(startTime)) ||
        !Number.isFinite(Date.parse(endTime)) ||
        Date.parse(endTime) <= Date.parse(startTime)) {
      issue = "O relatório contém um veículo ou intervalo de tempo inválido.";
    } else if (distanceMeters === null || durationMs === null ||
        averageSpeedKnots === null || maxSpeedKnots === null) {
      issue = "O relatório contém campos numéricos em falta ou inválidos.";
    } else if (distanceMeters < 0 || durationMs <= 0 ||
        averageSpeedKnots < 0 || maxSpeedKnots < 0) {
      issue = "O relatório contém distância, duração ou velocidade negativa.";
    } else if (maxSpeedKnots + 0.5 < averageSpeedKnots) {
      issue = "A velocidade média excede a velocidade máxima.";
    }

    return {
      deviceId: deviceId ?? 0,
      startTime,
      endTime,
      distanceMeters,
      durationMs,
      averageSpeedKmh: averageSpeedKnots === null
        ? null
        : knotsToKilometersPerHour(averageSpeedKnots),
      maxSpeedKmh: maxSpeedKnots === null
        ? null
        : knotsToKilometersPerHour(maxSpeedKnots),
      valid: issue === null,
      issue,
      startPositionId: finiteNumber(raw.startPositionId) ?? undefined,
      endPositionId: finiteNumber(raw.endPositionId) ?? undefined,
    };
  });
}

export function summarizeTripReports(trips: TripReport[]) {
  const validTrips = trips.filter((trip) => trip.valid);
  const totalDistanceMeters = validTrips.reduce(
    (total, trip) => total + (trip.distanceMeters ?? 0),
    0,
  );
  const totalDurationMs = validTrips.reduce(
    (total, trip) => total + (trip.durationMs ?? 0),
    0,
  );
  const maxSpeedKmh = validTrips.reduce(
    (maximum, trip) => Math.max(maximum, trip.maxSpeedKmh ?? 0),
    0,
  );

  return {
    validCount: validTrips.length,
    invalidCount: trips.length - validTrips.length,
    distanceKm: totalDistanceMeters / 1000,
    averageSpeedKmh: totalDurationMs > 0
      ? totalDistanceMeters * 3600 / totalDurationMs
      : null,
    maxSpeedKmh,
  };
}
