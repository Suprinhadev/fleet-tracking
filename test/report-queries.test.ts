import assert from "node:assert/strict";
import test from "node:test";
import {
  positionQuerySchema,
  reportRangeQuerySchema,
  summaryQuerySchema,
} from "../src/report-queries.js";

test("accepts ISO report ranges with UTC or explicit timezone offsets", () => {
  const parsed = reportRangeQuerySchema.safeParse({
    deviceId: "7",
    from: "2026-11-24T00:00:00+02:00",
    to: "2026-11-24T23:59:59+02:00",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.deviceId, 7);
  assert.equal(positionQuerySchema.safeParse({}).success, true);
});

test("rejects malformed or timezone-free report timestamps", () => {
  assert.equal(
    reportRangeQuerySchema.safeParse({
      deviceId: "7",
      from: "2026-11-24T00:00:00",
      to: "2026-11-24T23:59:59Z",
    }).success,
    false,
  );
});

test("rejects negative device IDs and malformed position query values", () => {
  const validRange = {
    from: "2026-11-24T00:00:00Z",
    to: "2026-11-24T23:59:59Z",
  };

  assert.equal(
    reportRangeQuerySchema.safeParse({ ...validRange, deviceId: "-7" }).success,
    false,
  );
  assert.equal(positionQuerySchema.safeParse({ deviceId: "-7" }).success, false);
  assert.equal(
    positionQuerySchema.safeParse({
      from: "invalid",
      to: "",
    }).success,
    false,
  );
});

test("parses the summary daily query as an explicit boolean", () => {
  const parsedFalse = summaryQuerySchema.safeParse({
    deviceId: "7",
    from: "2026-11-24T00:00:00Z",
    to: "2026-11-24T23:59:59Z",
    daily: "false",
  });
  const parsedTrue = summaryQuerySchema.safeParse({
    deviceId: "7",
    from: "2026-11-24T00:00:00Z",
    to: "2026-11-24T23:59:59Z",
    daily: "true",
  });

  assert.equal(parsedFalse.success && parsedFalse.data.daily, false);
  assert.equal(parsedTrue.success && parsedTrue.data.daily, true);
});
