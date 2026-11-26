import assert from "node:assert/strict";
import test from "node:test";
import {
  getLivePositionStatus,
  isValidCoordinates,
  mergeLatestPositions,
} from "../web/lib/position-state.js";

const NOW = Date.parse("2026-03-01T12:00:00.000Z");

function position(
  deviceId: number,
  id: number,
  fixTime: string,
  speed = 0,
) {
  return { id, deviceId, fixTime, speed };
}

test("position updates keep the newest fix per device across REST and live events", () => {
  const latest = position(1, 12, "2026-03-01T11:59:30.000Z", 2);
  const merged = mergeLatestPositions(
    [latest, position(2, 20, "2026-03-01T11:59:00.000Z")],
    [
      position(1, 10, "2026-03-01T11:58:00.000Z"),
      position(2, 21, "2026-03-01T11:59:10.000Z", 1),
    ],
  );

  assert.deepEqual(merged, [
    latest,
    position(2, 21, "2026-03-01T11:59:10.000Z", 1),
  ]);
});

test("position merge retains every vehicle instead of applying a fleet-wide cap", () => {
  const positions = Array.from({ length: 125 }, (_, index) =>
    position(index + 1, index + 1, "2026-03-01T11:59:00.000Z"),
  );

  assert.equal(mergeLatestPositions([], positions).length, 125);
});

test("position merge discards fixes with invalid timestamps", () => {
  const merged = mergeLatestPositions([], [
    position(1, 1, "not-a-date"),
    position(2, 2, "2026-03-01T11:59:00.000Z"),
  ]);

  assert.deepEqual(merged, [
    position(2, 2, "2026-03-01T11:59:00.000Z"),
  ]);
});

test("coordinates are validated before showing a map marker", () => {
  assert.equal(isValidCoordinates(-25.8, 32.5), true);
  assert.equal(isValidCoordinates(0, 0), true);
  assert.equal(isValidCoordinates(91, 32.5), false);
  assert.equal(isValidCoordinates(-25.8, Number.NaN), false);
});

test("position status matches the engine safety threshold and rejects stale data", () => {
  assert.equal(
    getLivePositionStatus(
      position(1, 1, "2026-03-01T11:59:00.000Z", 0.75),
      NOW,
    ),
    "moving",
  );
  assert.equal(
    getLivePositionStatus(
      {
        ...position(1, 1, "2026-03-01T11:59:00.000Z"),
        attributes: { motion: true },
      },
      NOW,
    ),
    "moving",
  );
  assert.equal(
    getLivePositionStatus(
      position(1, 1, "2026-03-01T11:40:00.000Z"),
      NOW,
    ),
    "stale",
  );
  assert.equal(
    getLivePositionStatus(
      position(1, 1, "2026-03-01T11:59:00.000Z", 0.5),
      NOW,
    ),
    "stationary",
  );
  assert.equal(
    getLivePositionStatus(
      position(1, 1, "2026-03-01T11:59:00.000Z", Number.NaN),
      NOW,
    ),
    "unknown",
  );
  assert.equal(
    getLivePositionStatus(
      position(1, 1, "2026-03-01T12:00:01.000Z"),
      NOW,
    ),
    "stale",
  );
  assert.equal(getLivePositionStatus(null, NOW), "no-data");
});
