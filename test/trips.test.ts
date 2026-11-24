import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTripReports,
  summarizeTripReports,
} from "../web/lib/trips.js";

test("normalizes Traccar report speeds from knots to km/h", () => {
  const [trip] = normalizeTripReports([{
    deviceId: 7,
    startTime: "2026-03-01T10:00:00Z",
    endTime: "2026-03-01T11:00:00Z",
    distance: 18_520,
    duration: 3_600_000,
    averageSpeed: 10,
    maxSpeed: 20,
  }]);

  assert.equal(trip.valid, true);
  assert.equal(trip.averageSpeedKmh, 18.52);
  assert.equal(trip.maxSpeedKmh, 37.04);
});

test("excludes negative and internally inconsistent reports from totals", () => {
  const trips = normalizeTripReports([
    {
      deviceId: 1,
      startTime: "2026-03-01T10:00:00Z",
      endTime: "2026-03-01T11:00:00Z",
      distance: -2_320,
      duration: 3_600_000,
      averageSpeed: 10,
      maxSpeed: 20,
    },
    {
      deviceId: 1,
      startTime: "2026-03-01T11:00:00Z",
      endTime: "2026-03-01T12:00:00Z",
      distance: 1_000,
      duration: 3_600_000,
      averageSpeed: 20,
      maxSpeed: 10,
    },
  ]);
  const summary = summarizeTripReports(trips);

  assert.deepEqual(trips.map((trip) => trip.valid), [false, false]);
  assert.equal(summary.invalidCount, 2);
  assert.equal(summary.distanceKm, 0);
  assert.equal(summary.averageSpeedKmh, null);
});

test("calculates fleet average speed using total distance and duration", () => {
  const trips = normalizeTripReports([
    {
      deviceId: 1,
      startTime: "2026-03-01T10:00:00Z",
      endTime: "2026-03-01T11:00:00Z",
      distance: 10_000,
      duration: 3_600_000,
      averageSpeed: 5,
      maxSpeed: 10,
    },
    {
      deviceId: 1,
      startTime: "2026-03-01T11:00:00Z",
      endTime: "2026-03-01T11:30:00Z",
      distance: 15_000,
      duration: 1_800_000,
      averageSpeed: 10,
      maxSpeed: 15,
    },
  ]);
  const summary = summarizeTripReports(trips);

  assert.equal(summary.distanceKm, 25);
  assert.ok(Math.abs((summary.averageSpeedKmh ?? 0) - 50 / 3) < 0.001);
  assert.ok(Math.abs(summary.maxSpeedKmh - 27.78) < 0.001);
});
