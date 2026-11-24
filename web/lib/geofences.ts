export type ParsedGeofenceArea =
  | { type: "circle"; center: [number, number]; radius: number }
  | { type: "polygon"; points: Array<[number, number]> };

export function polygonAreaWkt(points: Array<[number, number]>) {
  if (points.length < 3) return "";
  const closedPoints = [...points];
  const first = closedPoints[0];
  const last = closedPoints[closedPoints.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    closedPoints.push(first);
  }
  const coordinates = closedPoints
    .map(([latitude, longitude]) => `${latitude.toFixed(6)} ${longitude.toFixed(6)}`)
    .join(", ");
  return `POLYGON ((${coordinates}))`;
}

export function parseGeofenceArea(area: string): ParsedGeofenceArea | null {
  const circleMatch = area.match(
    /CIRCLE\s*\(\s*(-?\d+(?:[.,]\d+)?)\s*[,\s]\s*(-?\d+(?:[.,]\d+)?)\s*[,\s]\s*(\d+(?:[.,]\d+)?)\s*\)/i,
  );
  if (circleMatch) {
    return {
      type: "circle",
      center: [
        Number(circleMatch[1].replace(",", ".")),
        Number(circleMatch[2].replace(",", ".")),
      ],
      radius: Number(circleMatch[3].replace(",", ".")),
    };
  }

  const polygonMatch = area.match(/POLYGON\s*\(\s*\(([^()]*)\)\s*\)/i);
  if (!polygonMatch) return null;

  const points = polygonMatch[1]
    .split(",")
    .map((point) => {
      const [latitude, longitude] = point.trim().split(/\s+/).map(Number);
      return [latitude, longitude] as [number, number];
    })
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  return points.length > 2 ? { type: "polygon", points } : null;
}
