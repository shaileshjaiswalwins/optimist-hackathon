export type VehicleTuning = {
  massKg: number;
  suspensionRestLength: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  suspensionMaxForce: number;
  tireGrip: number;
  sideFriction: number;
  engineForce: number;
  brakeForce: number;
  maxSteeringAngle: number;
  highSpeedSteeringFactor: number;
  topSpeedKmh: number;
};

// Per-vehicle feel for the local Rapier raycast vehicle. topSpeedKmh here is
// derived from the server's authoritative VEHICLE_DYNAMICS (spacetimedb/src/index.ts)
// so client prediction doesn't fight the server correction every frame:
//   auto:   17.5 m/s -> 63.0 km/h
//   scooty: 20.0 m/s -> 72.0 km/h
//   thar:   24.0 m/s -> 86.4 km/h
// Keep both files in sync by hand if server dynamics change.
export const VEHICLE_TUNINGS: Record<string, VehicleTuning> = {
  auto: {
    massKg: 620,
    suspensionRestLength: 0.32,
    suspensionStiffness: 30,
    suspensionCompression: 5.6,
    suspensionRelaxation: 6.8,
    suspensionMaxForce: 6200,
    tireGrip: 1.5,
    sideFriction: 1.6,
    engineForce: 1150,
    brakeForce: 80,
    maxSteeringAngle: 0.52,
    highSpeedSteeringFactor: 0.5,
    topSpeedKmh: 63,
  },
  scooty: {
    massKg: 210,
    suspensionRestLength: 0.26,
    suspensionStiffness: 26,
    suspensionCompression: 4.4,
    suspensionRelaxation: 5.6,
    suspensionMaxForce: 3400,
    tireGrip: 1.35,
    sideFriction: 1.2,
    engineForce: 780,
    brakeForce: 58,
    maxSteeringAngle: 0.58,
    highSpeedSteeringFactor: 0.4,
    topSpeedKmh: 72,
  },
  thar: {
    massKg: 1450,
    suspensionRestLength: 0.4,
    suspensionStiffness: 38,
    suspensionCompression: 5.8,
    suspensionRelaxation: 7,
    suspensionMaxForce: 9200,
    tireGrip: 1.75,
    sideFriction: 1.55,
    engineForce: 2100,
    brakeForce: 110,
    maxSteeringAngle: 0.42,
    highSpeedSteeringFactor: 0.5,
    topSpeedKmh: 86.4,
  },
};

export function vehicleTuningFor(vehicleType: string): VehicleTuning {
  return VEHICLE_TUNINGS[vehicleType] ?? VEHICLE_TUNINGS.auto;
}

export const vehicleTuningFields: Array<{
  key: keyof VehicleTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'massKg', label: 'Mass (kg)', min: 150, max: 1600, step: 10 },
  { key: 'suspensionStiffness', label: 'Spring stiffness', min: 8, max: 80, step: 1 },
  { key: 'suspensionCompression', label: 'Compression damping', min: 0.5, max: 14, step: 0.1 },
  { key: 'suspensionRelaxation', label: 'Rebound damping', min: 0.5, max: 16, step: 0.1 },
  { key: 'tireGrip', label: 'Tyre grip / slip', min: 0.3, max: 3, step: 0.05 },
  { key: 'sideFriction', label: 'Lateral grip', min: 0.2, max: 3, step: 0.05 },
  { key: 'engineForce', label: 'Engine / wheel', min: 300, max: 3200, step: 50 },
  { key: 'brakeForce', label: 'Brake / wheel', min: 10, max: 220, step: 5 },
  { key: 'maxSteeringAngle', label: 'Max steering', min: 0.1, max: 0.75, step: 0.01 },
  { key: 'topSpeedKmh', label: 'Top speed (km/h)', min: 45, max: 130, step: 1 },
];
