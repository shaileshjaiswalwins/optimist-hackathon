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

// One mutable source of truth for the local Rapier raycast vehicle. Values are
// deliberately in SI-like game units: forces are per driven wheel and the
// chassis collider is given this density-derived mass.
export const vehicleTuning: VehicleTuning = {
  massKg: 820,
  suspensionRestLength: 0.34,
  suspensionStiffness: 34,
  suspensionCompression: 5.2,
  suspensionRelaxation: 6.4,
  suspensionMaxForce: 7600,
  tireGrip: 1.65,
  sideFriction: 1.45,
  engineForce: 1600,
  brakeForce: 92,
  maxSteeringAngle: 0.48,
  highSpeedSteeringFactor: 0.46,
  topSpeedKmh: 90,
};

export const vehicleTuningFields: Array<{
  key: keyof VehicleTuning;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'massKg', label: 'Mass (kg)', min: 500, max: 1400, step: 10 },
  { key: 'suspensionStiffness', label: 'Spring stiffness', min: 8, max: 80, step: 1 },
  { key: 'suspensionCompression', label: 'Compression damping', min: 0.5, max: 14, step: 0.1 },
  { key: 'suspensionRelaxation', label: 'Rebound damping', min: 0.5, max: 16, step: 0.1 },
  { key: 'tireGrip', label: 'Tyre grip / slip', min: 0.3, max: 3, step: 0.05 },
  { key: 'sideFriction', label: 'Lateral grip', min: 0.2, max: 3, step: 0.05 },
  { key: 'engineForce', label: 'Engine / wheel', min: 500, max: 3200, step: 50 },
  { key: 'brakeForce', label: 'Brake / wheel', min: 10, max: 220, step: 5 },
  { key: 'maxSteeringAngle', label: 'Max steering', min: 0.1, max: 0.75, step: 0.01 },
  { key: 'topSpeedKmh', label: 'Top speed (km/h)', min: 45, max: 130, step: 1 },
];
