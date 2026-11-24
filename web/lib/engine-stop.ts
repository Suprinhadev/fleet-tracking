type PositionForEngineStop = {
  fixTime?: string;
  speed?: number;
  attributes?: Record<string, unknown>;
};

const MAX_POSITION_AGE_MS = 10 * 60 * 1000;
const MAX_STATIONARY_SPEED_KNOTS = 0.5;

export function getEngineStopBlockReason(
  position: PositionForEngineStop | null | undefined,
  now = Date.now(),
) {
  if (!position) return "Não há posição GPS recente.";

  const fixTime = position.fixTime ? Date.parse(position.fixTime) : NaN;
  const age = now - fixTime;
  if (!Number.isFinite(fixTime) || age < 0 || age > MAX_POSITION_AGE_MS) {
    return "A última posição GPS não é dos últimos 10 minutos.";
  }
  if (typeof position.speed !== "number" || !Number.isFinite(position.speed) ||
      position.speed < 0) {
    return "A velocidade GPS não é válida.";
  }
  if (position.speed > MAX_STATIONARY_SPEED_KNOTS ||
      position.attributes?.motion === true ||
      position.attributes?.motion === "true") {
    return "A leitura recente indica movimento.";
  }
  return null;
}
