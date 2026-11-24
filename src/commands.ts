type PositionForEngineStop = {
  fixTime?: string;
  speed?: number;
  attributes?: Record<string, unknown>;
};

const ENGINE_STOP_MAX_POSITION_AGE_MS = 10 * 60 * 1000;
const ENGINE_STOP_MAX_SPEED_KNOTS = 0.5;

export function getEngineStopSafetyError(
  position: PositionForEngineStop | null,
  now = Date.now(),
): string | null {
  if (!position) {
    return "Bloqueio rejeitado: não há posição GPS recente.";
  }

  const fixTime = position.fixTime ? Date.parse(position.fixTime) : NaN;
  const age = now - fixTime;
  if (!Number.isFinite(fixTime) || age < 0 || age > ENGINE_STOP_MAX_POSITION_AGE_MS) {
    return "Bloqueio rejeitado: é necessária uma posição GPS válida dos últimos 10 minutos.";
  }

  if (typeof position.speed !== "number" || !Number.isFinite(position.speed)) {
    return "Bloqueio rejeitado: a velocidade atual não é confiável.";
  }

  if (position.speed < 0) {
    return "Bloqueio rejeitado: a velocidade atual não é confiável.";
  }

  const motion = position.attributes?.motion;
  if (position.speed > ENGINE_STOP_MAX_SPEED_KNOTS ||
      motion === true || motion === "true") {
    return "Bloqueio rejeitado: a posição recente indica que o veículo pode estar em movimento.";
  }

  return null;
}
