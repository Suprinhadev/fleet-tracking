const KNOTS_TO_KILOMETERS_PER_HOUR = 1.852;

export function knotsToKilometersPerHour(speedKnots: number) {
  return speedKnots * KNOTS_TO_KILOMETERS_PER_HOUR;
}
