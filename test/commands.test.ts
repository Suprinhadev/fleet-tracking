import assert from "node:assert/strict";
import test from "node:test";
import { getEngineStopSafetyError } from "../src/commands.js";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");

test("engine stop fails closed when there is no position or speed", () => {
  assert.match(getEngineStopSafetyError(null, NOW) || "", /posição GPS recente/);
  assert.match(
    getEngineStopSafetyError({ fixTime: "2026-03-01T11:59:00.000Z" }, NOW) || "",
    /velocidade atual não é confiável/,
  );
});

test("engine stop rejects stale, future, or moving positions", () => {
  assert.match(
    getEngineStopSafetyError({
      fixTime: "2026-03-01T11:49:59.000Z",
      speed: 0,
    }, NOW) || "",
    /últimos 10 minutos/,
  );
  assert.match(
    getEngineStopSafetyError({
      fixTime: "2026-03-01T12:00:01.000Z",
      speed: 0,
    }, NOW) || "",
    /últimos 10 minutos/,
  );
  assert.match(
    getEngineStopSafetyError({
      fixTime: "2026-03-01T11:59:00.000Z",
      speed: 1,
    }, NOW) || "",
    /pode estar em movimento/,
  );
  assert.match(
    getEngineStopSafetyError({
      fixTime: "2026-03-01T11:59:00.000Z",
      speed: 0,
      attributes: { motion: "true" },
    }, NOW) || "",
    /pode estar em movimento/,
  );
  assert.match(
    getEngineStopSafetyError({
      fixTime: "2026-03-01T11:59:00.000Z",
      speed: -1,
    }, NOW) || "",
    /velocidade atual não é confiável/,
  );
});

test("engine stop accepts only a recent stationary position", () => {
  assert.equal(
    getEngineStopSafetyError({
      fixTime: "2026-03-01T11:59:00.000Z",
      speed: 0.5,
      attributes: { motion: false },
    }, NOW),
    null,
  );
});
