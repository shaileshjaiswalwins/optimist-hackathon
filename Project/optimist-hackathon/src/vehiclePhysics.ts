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

// Mirrors VEHICLE_DYNAMICS + the gameTick integration in
// spacetimedb/src/index.ts. Local prediction must use the same arcade strafe
// (x += steering * lateralSpeed * dt), not a yawing raycast vehicle, or the
// car slams into the curb and the wall-clamp kills forward motion.
export type ArcadeDynamics = {
  topSpeed: number;
  acceleration: number;
  coastDeceleration: number;
};

export const ARCADE_DYNAMICS: Record<string, ArcadeDynamics> = {
  auto: { topSpeed: 17.5, acceleration: 3.4, coastDeceleration: 0.9 },
  scooty: { topSpeed: 20, acceleration: 3.8, coastDeceleration: 0.75 },
  thar: { topSpeed: 24, acceleration: 4.2, coastDeceleration: 1.05 },
};

export const LATERAL_SPEED_CAP = 4.2;
export const LATERAL_SPEED_FACTOR = 0.18;
export const BOOST_SPEED_FACTOR = 1.12;

export type ArcadeDriveState = {
  x: number;
  distance: number;
  speed: number;
};

export function arcadeDynamicsFor(vehicleType: string): ArcadeDynamics {
  return ARCADE_DYNAMICS[vehicleType] ?? ARCADE_DYNAMICS.auto;
}

export function stepArcadeDrive(
  state: ArcadeDriveState,
  input: { steering: number; throttle: number; boost: boolean },
  vehicleType: string,
  dt: number,
  roadHalfWidth: number,
) {
  const dynamics = arcadeDynamicsFor(vehicleType);
  const topSpeed = dynamics.topSpeed * (input.boost ? BOOST_SPEED_FACTOR : 1);
  const engineAcceleration = dynamics.acceleration * input.throttle * Math.max(0.15, 1 - state.speed / Math.max(topSpeed, 0.001));
  const acceleration = input.throttle > 0 ? engineAcceleration : -dynamics.coastDeceleration;
  state.speed = Math.max(0, Math.min(topSpeed, state.speed + acceleration * dt));
  const lateralSpeed = Math.min(LATERAL_SPEED_CAP, state.speed * LATERAL_SPEED_FACTOR);
  state.x = Math.max(-roadHalfWidth, Math.min(roadHalfWidth, state.x + input.steering * lateralSpeed * dt));
  state.distance += state.speed * dt;
  return state;
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
