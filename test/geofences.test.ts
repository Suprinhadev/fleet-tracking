import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGeofenceArea,
  polygonAreaWkt,
} from "../web/lib/geofences.js";

test("closes a polygon and emits Traccar-compatible WKT", () => {
  const area = polygonAreaWkt([
    [-25.86, 32.54],
    [-25.87, 32.55],
    [-25.88, 32.54],
  ]);

  assert.equal(
    area,
    "POLYGON ((-25.860000 32.540000, -25.870000 32.550000, -25.880000 32.540000, -25.860000 32.540000))",
  );
  assert.deepEqual(parseGeofenceArea(area), {
    type: "polygon",
    points: [
      [-25.86, 32.54],
      [-25.87, 32.55],
      [-25.88, 32.54],
      [-25.86, 32.54],
    ],
  });
});

test("parses existing circle geofences and rejects incomplete polygons", () => {
  assert.deepEqual(parseGeofenceArea("CIRCLE (-25.86,32.54,500)"), {
    type: "circle",
    center: [-25.86, 32.54],
    radius: 500,
  });
  assert.equal(parseGeofenceArea("POLYGON ((-25 32, -26 33))"), null);
});
