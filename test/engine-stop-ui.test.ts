import assert from "node:assert/strict";
import test from "node:test";
import { getEngineStopBlockReason } from "../web/lib/engine-stop.js";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");

test("engine stop UI explains stale and moving position blocks", () => {
  assert.match(
    getEngineStopBlockReason({
      fixTime: "2026-03-01T11:40:00.000Z",
      speed: 0,
    }, NOW) || "",
    /últimos 10 minutos/,
  );
  assert.match(
    getEngineStopBlockReason({
      fixTime: "2026-03-01T11:59:00.000Z",
      speed: 1,
    }, NOW) || "",
    /indica movimento/,
  );
});

test("engine stop UI allows only a fresh stationary GPS reading", () => {
  assert.equal(
    getEngineStopBlockReason({
      fixTime: "2026-03-01T11:59:00.000Z",
      speed: 0.5,
      attributes: { motion: false },
    }, NOW),
    null,
  );
});
