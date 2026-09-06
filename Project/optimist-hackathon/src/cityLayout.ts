export type CityZone = {
  id: 'orr' | 'outskirts' | 'cbd' | 'old-bangalore';
  label: string;
  start: number;
  end: number;
  landmark: string;
  style: 'glass' | 'construction' | 'commercial' | 'heritage';
};

// Distances are route metres from the ORR office start to an Old Bangalore
// finish. Keeping this as data makes it safe to rebalance the route without
// changing rendering code.
export const CITY_ROUTE_ZONES: readonly CityZone[] = [
  { id: 'orr', label: 'ORR / Whitefield', start: 0, end: 150, landmark: 'ECOSPACE', style: 'glass' },
  { id: 'outskirts', label: 'Bellandur → Silk Board', start: 150, end: 285, landmark: 'SILK BOARD', style: 'construction' },
  { id: 'cbd', label: 'MG Road / Brigade Road', start: 285, end: 430, landmark: 'TRINITY CIRCLE', style: 'commercial' },
  { id: 'old-bangalore', label: 'Basavanagudi / Malleswaram', start: 430, end: 620, landmark: 'VIDHANA SOUDHA', style: 'heritage' },
];

export const CITY_ROUTE_LOOP = 620;

export function cityZoneAt(distance: number): CityZone {
  const routeDistance = ((distance % CITY_ROUTE_LOOP) + CITY_ROUTE_LOOP) % CITY_ROUTE_LOOP;
  return CITY_ROUTE_ZONES.find(zone => routeDistance >= zone.start && routeDistance < zone.end) ?? CITY_ROUTE_ZONES[0];
}
