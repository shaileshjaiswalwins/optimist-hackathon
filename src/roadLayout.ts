// Mirrors laneCountFor/laneCenters/LANE_WIDTH in spacetimedb/src/index.ts.
// Keep both in sync by hand: the client uses this only to size the road mesh
// and place cars/camera, never to decide gameplay outcomes.
export const LANE_WIDTH = 3.2;
const MIN_LANES = 3;
const MAX_LANES = 7;

export function laneCountFor(fieldSize: number): number {
  return Math.min(MAX_LANES, MIN_LANES + Math.floor(fieldSize / 5));
}

export function laneCenters(laneCount: number): number[] {
  const centers: number[] = [];
  const span = (laneCount - 1) / 2;
  for (let index = 0; index < laneCount; index += 1) centers.push((index - span) * LANE_WIDTH);
  return centers;
}

export function roadHalfWidthFor(fieldSize: number): number {
  const lanes = laneCountFor(fieldSize);
  return (lanes - 1) / 2 * LANE_WIDTH + 1.45;
}
