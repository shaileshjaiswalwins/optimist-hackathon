import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CITY_ROUTE_LOOP, CITY_ROUTE_ZONES } from './cityLayout';
import { stepArcadeDrive, type ArcadeDriveState } from './vehiclePhysics';
import { roadHalfWidthFor } from './roadLayout';
import { playHit } from './gameAudio';

const TRAFFIC_ASSETS = [
  '/assets/kenney/car-kit/sedan.glb',
  '/assets/kenney/car-kit/taxi.glb',
  '/assets/kenney/car-kit/delivery.glb',
  '/assets/kenney/car-kit/ambulance.glb',
  '/assets/kenney/car-kit/truck.glb',
  '/assets/kenney/car-kit/police.glb',
];

// Only 3 pre-built Building_* variants ship in the Quaternius kit; the rest of
// the folder is modular wall/roof/trim pieces meant for hand-assembly, which
// is out of scope here. Space in "glTF (Godot)" must stay percent-encoded.
const BUILDING_ASSETS = [
  '/assets/quaternius/downtown-citymegakit/Exports/glTF%20(Godot)/Building_Small_1.gltf',
  '/assets/quaternius/downtown-citymegakit/Exports/glTF%20(Godot)/Building_Medium_2_001.gltf',
  '/assets/quaternius/downtown-citymegakit/Exports/glTF%20(Godot)/Building_Large_2.gltf',
];

// Leave enough of the server's 12s preparation window to build and render
// the procedural fallback, then round-trip markPlayerReady.
const ASSET_LOAD_MS = 7000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      value => {
        window.clearTimeout(timer);
        resolve(value);
      },
      error => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type Profile = {
  playerId: bigint;
  name: string;
  vehicleType: string;
  isBot: boolean;
};

type Position = {
  playerId: bigint;
  x: number;
  distance: number;
  speed: number;
  steering: number;
};

type Obstacle = {
  obstacleId: bigint;
  x: number;
  distance: number;
  active: boolean;
  kind?: string;
};

type AttackEvent = {
  attackerPlayerId: bigint;
  targetPlayerId: bigint;
  attackKind: string;
  createdAt: { toMillis(): bigint };
};

type Props = {
  myPlayerId: bigint;
  profiles: readonly Profile[];
  positions: readonly Position[];
  obstacles: readonly Obstacle[];
  attackEvents: readonly AttackEvent[];
  input: { current: { steering: number; throttle: number; boost: boolean } };
  onReady: () => void;
};

type Weather = 'clear' | 'rain';

function initialWeather(): Weather {
  return new URLSearchParams(window.location.search).get('weather') === 'rain' ? 'rain' : 'clear';
}

function timeOfDay(hour: number) {
  if (hour >= 6 && hour < 9) return 'morning' as const;
  if (hour >= 9 && hour < 17) return 'noon' as const;
  if (hour >= 17 && hour < 19) return 'evening' as const;
  return 'morning' as const;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  mesh.position.set(x, y, z);
  return mesh;
}

function cylinder(radius: number, height: number, color: number, x = 0, y = 0, z = 0, sides = 10) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, sides),
    new THREE.MeshLambertMaterial({ color })
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function wheel(x: number, z: number, radius = 0.35, width = 0.25) {
  const group = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 12),
    new THREE.MeshLambertMaterial({ color: 0x151515 })
  );
  tire.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width + 0.04, 10),
    new THREE.MeshLambertMaterial({ color: 0xc9c4b8 })
  );
  hub.rotation.z = Math.PI / 2;
  group.add(tire, hub);
  group.position.set(x, radius, z);
  return group;
}

function addFourWheels(group: THREE.Group, width: number, front: number, rear: number, radius = 0.35) {
  for (const x of [-width, width]) {
    const frontWheel = wheel(x, front, radius);
    const rearWheel = wheel(x, rear, radius);
    frontWheel.userData.isWheel = true;
    rearWheel.userData.isWheel = true;
    group.add(frontWheel, rearWheel);
  }
}

function articulatedLeg(color: number, x: number, y: number, z: number, attackOnly = false) {
  const pivot = new THREE.Group();
  const leg = box(0.15, 0.58, 0.18, color, 0, -0.27, 0);
  pivot.position.set(x, y, z);
  pivot.add(leg);
  pivot.userData.attackOnly = attackOnly;
  pivot.visible = !attackOnly;
  return pivot;
}

function addSeatedDriver(group: THREE.Group, x: number, y: number, z: number, shirt: number, attackLegs: boolean) {
  const skin = 0xc98561;
  group.add(box(0.48, 0.58, 0.34, shirt, x, y, z));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), new THREE.MeshLambertMaterial({ color: skin }));
  head.position.set(x, y + 0.45, z - 0.05);
  group.add(head);
  const leftLeg = articulatedLeg(0x26364a, x - 0.23, y - 0.2, z - 0.12, attackLegs);
  const rightLeg = articulatedLeg(0x26364a, x + 0.23, y - 0.2, z - 0.12, attackLegs);
  group.add(leftLeg, rightLeg);
  group.userData.attackLegLeft = leftLeg;
  group.userData.attackLegRight = rightLeg;
}

function addScootyRider(group: THREE.Group, shirt: number) {
  // A compact low-poly rider makes the scooty read as a vehicle being driven,
  // rather than an empty prop. The silhouette stays clear on mobile.
  group.add(cylinder(0.22, 0.46, 0x7a4e35, 0, 2.12, 0.16, 10));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshLambertMaterial({ color: 0xc98561 }));
  head.position.set(0, 2.48, 0.08);
  group.add(head);
  group.add(box(0.5, 0.62, 0.36, shirt, 0, 1.88, 0.08));
  const leftLeg = articulatedLeg(0x26364a, -0.2, 1.62, 0.36);
  const rightLeg = articulatedLeg(0x26364a, 0.2, 1.62, 0.36);
  group.add(leftLeg, rightLeg);
  group.userData.attackLegLeft = leftLeg;
  group.userData.attackLegRight = rightLeg;
  const handleArm = box(0.12, 0.52, 0.12, 0xc98561, 0.24, 1.95, -0.34);
  handleArm.rotation.z = -0.72;
  const otherArm = handleArm.clone();
  otherArm.position.x = -0.24;
  otherArm.rotation.z = 0.72;
  group.add(handleArm, otherArm);
}

function createAuto(color: number) {
  const group = new THREE.Group();
  group.add(box(1.28, 0.28, 2.05, 0x1a1a1a, 0, 0.42, 0.1));
  group.add(box(1.42, 1.02, 1.42, color, 0, 1.12, 0.36));
  group.add(box(1.48, 0.12, 1.52, 0x161616, 0, 1.7, 0.3));
  group.add(box(1.5, 0.08, 0.18, 0xf2c94c, 0, 1.78, 0.3));
  const nose = box(0.7, 0.4, 0.88, color, 0, 0.78, -0.82);
  nose.rotation.x = 0.32;
  group.add(nose);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.52, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x9ed9e9, transparent: true, opacity: 0.48 })
  );
  glass.position.set(0, 1.28, -0.4);
  glass.rotation.x = -0.38;
  group.add(glass);
  group.add(box(0.06, 0.48, 0.72, 0x222222, -0.72, 1.12, 0.32));
  group.add(box(0.06, 0.48, 0.72, 0x222222, 0.72, 1.12, 0.32));
  group.add(box(0.95, 0.07, 0.07, 0x222222, 0, 1.42, -0.58));
  group.add(cylinder(0.04, 0.32, 0x333333, 0, 1.2, -0.52, 8));
  group.add(box(0.3, 0.18, 0.1, 0xfff3c4, 0, 0.7, -1.18));
  group.add(box(1.18, 0.14, 0.38, 0x3a2a1a, 0, 0.78, 0.82));
  group.add(box(0.08, 0.55, 0.08, 0x333333, 0, 0.72, -0.92));
  group.add(wheel(-0.62, 0.72, 0.32), wheel(0.62, 0.72, 0.32), wheel(0, -0.95, 0.3));
  addSeatedDriver(group, 0, 1.2, -0.03, 0x2f6f4e, true);
  return group;
}

function createScooty(color: number) {
  const group = new THREE.Group();
  group.add(wheel(0, 0.72, 0.38, 0.22), wheel(0, -0.95, 0.36, 0.2));
  group.add(box(0.42, 0.16, 1.15, 0x2a2a2a, 0, 0.52, -0.08));
  group.add(box(0.58, 0.32, 0.85, color, 0, 0.78, 0.18));
  group.add(box(0.52, 0.16, 0.7, 0x1f1f1f, 0, 1.08, 0.22));
  group.add(box(0.7, 0.85, 0.22, color, 0, 1.05, -0.72));
  group.add(box(0.38, 0.28, 0.16, 0xf2e092, 0, 1.22, -0.86));
  group.add(box(0.12, 0.7, 0.12, 0xb8c2c4, 0, 1.15, -0.62));
  group.add(box(0.95, 0.08, 0.08, 0x252525, 0, 1.72, -0.62));
  group.add(box(0.16, 0.12, 0.22, 0x333333, -0.42, 1.74, -0.62));
  group.add(box(0.16, 0.12, 0.22, 0x333333, 0.42, 1.74, -0.62));
  group.add(box(0.36, 0.28, 0.32, color, 0, 0.88, 0.72));
  addScootyRider(group, color === 0x52d7c2 ? 0xc53f4d : color);
  return group;
}

function createThar(color: number) {
  const group = new THREE.Group();
  group.add(box(1.88, 0.72, 3.15, color, 0, 0.86, 0));
  group.add(box(1.78, 1.02, 1.72, color, 0, 1.68, 0.38));
  group.add(box(1.82, 0.1, 1.82, 0x202629, 0, 2.22, 0.38));
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.48, 0.55, 0.07),
    new THREE.MeshLambertMaterial({ color: 0x8dc7db, transparent: true, opacity: 0.46 })
  );
  windshield.position.set(0, 1.78, -0.5);
  group.add(windshield);
  group.add(box(0.08, 0.42, 0.7, 0x8dc7db, -0.88, 1.72, 0.28));
  group.add(box(0.08, 0.42, 0.7, 0x8dc7db, 0.88, 1.72, 0.28));
  group.add(box(1.05, 0.42, 0.08, 0x1b1b1b, 0, 0.95, -1.6));
  for (const slotX of [-0.36, -0.18, 0, 0.18, 0.36]) {
    group.add(box(0.08, 0.32, 0.04, 0x0d0d0d, slotX, 0.95, -1.64));
  }
  group.add(cylinder(0.16, 0.08, 0xffefaa, -0.62, 0.98, -1.62, 10));
  group.add(cylinder(0.16, 0.08, 0xffefaa, 0.62, 0.98, -1.62, 10));
  group.add(box(0.16, 0.7, 0.16, 0x2a2a2a, -0.82, 1.45, 0.85));
  group.add(cylinder(0.38, 0.16, 0x1a1a1a, 0, 1.05, 1.62, 12));
  group.add(box(1.7, 0.12, 0.28, 0x1a1a1a, 0, 0.58, -1.52));
  addFourWheels(group, 0.94, -1.05, 1.05, 0.43);
  addSeatedDriver(group, -0.38, 1.55, -0.16, 0xc53f4d, false);
  return group;
}

function addDamageFx(group: THREE.Group) {
  const fx = new THREE.Group();
  const dent = box(0.72, 0.32, 0.08, 0x171717, 0.65, 1, -0.35);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: 0x343434, transparent: true, opacity: 0.62, depthWrite: false });
  for (let index = 0; index < 3; index += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.18 + index * 0.06, 7, 5), smokeMaterial.clone());
    puff.position.set(0.45 - index * 0.18, 1.65 + index * 0.24, 0.18);
    fx.add(puff);
  }
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffb11b });
  for (const x of [-0.72, 0.72]) {
    const spark = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.42, 5), sparkMaterial);
    spark.position.set(x, 0.72, -0.45);
    spark.rotation.z = x > 0 ? -1 : 1;
    fx.add(spark);
  }
  fx.add(dent);
  fx.visible = false;
  group.add(fx);
  group.userData.damageFx = fx;
}

function createPlayerVehicle(profile: Profile) {
  const accent = profile.isBot ? 0xf06445 : profile.vehicleType === 'auto' ? 0xf6c344 : profile.vehicleType === 'scooty' ? 0x52d7c2 : 0x5f91e8;
  const vehicle = profile.vehicleType === 'auto'
    ? createAuto(accent)
    : profile.vehicleType === 'scooty'
      ? createScooty(accent)
      : createThar(accent);
  addDamageFx(vehicle);
  vehicle.userData.vehicleType = profile.vehicleType;
  return vehicle;
}

function createTrafficVehicle(variant: number) {
  const group = new THREE.Group();
  const kind = variant % 6;
  if (kind === 0) {
    group.add(box(1.72, 0.58, 3.15, 0xc45c48, 0, 0.68, 0));
    group.add(box(1.58, 0.62, 1.55, 0xd97a5c, 0, 1.22, 0.22));
    group.add(box(1.32, 0.38, 0.06, 0x9ad4e6, 0, 1.28, -0.58));
    group.add(box(0.22, 0.14, 0.08, 0xfff1b0, -0.5, 0.72, -1.58));
    group.add(box(0.22, 0.14, 0.08, 0xfff1b0, 0.5, 0.72, -1.58));
    addFourWheels(group, 0.82, -1.05, 1.05);
  } else if (kind === 1) {
    group.add(box(1.72, 0.58, 3.15, 0xf0c33a, 0, 0.68, 0));
    group.add(box(1.58, 0.62, 1.55, 0xf0c33a, 0, 1.22, 0.22));
    group.add(box(1.32, 0.38, 0.06, 0x9ad4e6, 0, 1.28, -0.58));
    group.add(box(1.4, 0.18, 0.04, 0x1a1a1a, 0, 1.05, 0.18));
    addFourWheels(group, 0.82, -1.05, 1.05);
  } else if (kind === 2) {
    group.add(box(1.85, 0.7, 2.2, 0xf2f2f0, 0, 0.78, -0.85));
    group.add(box(1.95, 1.35, 2.55, 0x4f7fbf, 0, 1.28, 1.05));
    group.add(box(1.5, 0.45, 0.06, 0xa8dbe7, 0, 1.2, -1.85));
    addFourWheels(group, 0.9, -1.35, 1.45, 0.4);
  } else if (kind === 3) {
    group.add(box(1.85, 0.7, 3.6, 0xf4f4f4, 0, 0.78, 0));
    group.add(box(1.78, 0.85, 1.7, 0xe23b3b, 0, 1.45, 0.15));
    group.add(box(1.4, 0.4, 0.06, 0x9ad4e6, 0, 1.4, -0.72));
    group.add(box(0.18, 0.35, 0.5, 0xe23b3b, 0, 2.05, 0.05));
    addFourWheels(group, 0.88, -1.15, 1.2, 0.4);
  } else if (kind === 4) {
    group.add(box(2.05, 0.75, 2.4, 0x4a5560, 0, 0.85, -1.05));
    group.add(box(2.15, 1.45, 3.05, 0x6b7780, 0, 1.42, 1.15));
    group.add(box(1.65, 0.5, 0.06, 0xbde3ed, 0, 1.28, -2.15));
    addFourWheels(group, 0.98, -1.55, 1.55, 0.44);
  } else {
    group.add(box(1.78, 0.6, 3.25, 0x2d4d8a, 0, 0.7, 0));
    group.add(box(1.62, 0.62, 1.55, 0x2d4d8a, 0, 1.24, 0.2));
    group.add(box(1.32, 0.38, 0.06, 0x9ad4e6, 0, 1.28, -0.58));
    group.add(box(0.35, 0.12, 0.08, 0xf2c94c, -0.55, 0.62, -1.62));
    group.add(box(0.35, 0.12, 0.08, 0xf2c94c, 0.55, 0.62, -1.62));
    addFourWheels(group, 0.84, -1.08, 1.08);
    addPoliceLights(group, 1.62);
  }
  return group;
}

function addPoliceLights(group: THREE.Group, roofY: number) {
  const bar = box(0.78, 0.1, 0.24, 0x161616, 0, roofY, 0.12);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.22), new THREE.MeshBasicMaterial({ color: 0xff1a2a }));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.22), new THREE.MeshBasicMaterial({ color: 0x1a5cff }));
  red.position.set(-0.18, roofY + 0.12, 0.12);
  blue.position.set(0.18, roofY + 0.12, 0.12);
  group.add(bar, red, blue);
  group.userData.policeLights = [red, blue];
}

function createPoliceCar() {
  const group = createTrafficVehicle(5);
  group.userData.kind = 'police';
  return group;
}

function createPedestrian(variant: number) {
  const group = new THREE.Group();
  const shirts = [0xc53f4d, 0x2f6f4e, 0x3b5bdb, 0xeab308, 0x7c3aed];
  const shirt = shirts[variant % shirts.length];
  const skin = 0xc98561;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshLambertMaterial({ color: skin }));
  head.position.set(0, 1.68, 0);
  const leftLeg = box(0.12, 0.42, 0.14, 0x26364a, -0.08, 0.82, 0);
  const rightLeg = box(0.12, 0.42, 0.14, 0x26364a, 0.08, 0.82, 0);
  const leftArm = box(0.1, 0.38, 0.1, skin, -0.26, 1.28, 0);
  const rightArm = box(0.1, 0.38, 0.1, skin, 0.26, 1.28, 0);
  group.add(head);
  group.add(box(0.36, 0.48, 0.22, shirt, 0, 1.28, 0));
  group.add(leftLeg, rightLeg, leftArm, rightArm);
  group.userData.kind = 'pedestrian';
  group.userData.walkParts = { leftLeg, rightLeg, leftArm, rightArm };
  return group;
}

function createHeartPickup() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xe11d48 });
  const left = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), mat);
  const right = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), mat);
  left.position.set(-0.16, 1.12, 0);
  right.position.set(0.16, 1.12, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.52, 8), mat);
  tip.rotation.x = Math.PI;
  tip.position.set(0, 0.78, 0);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.58, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff6b8a, transparent: true, opacity: 0.28 })
  );
  glow.position.y = 1;
  group.add(left, right, tip, glow);
  group.userData.kind = 'powerup';
  return group;
}

function markKenneyWheels(root: THREE.Object3D) {
  root.traverse(child => {
    if (/wheel/i.test(child.name)) child.userData.isWheel = true;
  });
}

function spinWheels(root: THREE.Object3D, amount: number) {
  root.traverse(child => {
    if (child.userData.isWheel) child.rotation.x += amount;
  });
}

function stripTrafficDecor(root: THREE.Object3D) {
  const remove: THREE.Object3D[] = [];
  root.traverse(child => {
    const name = child.name.toLowerCase();
    if (/label|text|nameplate|shadow|decal|car\s*\d|bike\s*\d|player\s*\d/.test(name)) remove.push(child);
  });
  for (const child of remove) child.parent?.remove(child);
}

function normalizeAsset(source: THREE.Group, targetSize: number, byHeight = false, maxFootprint?: number) {
  const container = new THREE.Group();
  const model = source.clone(true);
  container.add(model);
  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const size = initialBounds.getSize(new THREE.Vector3());
  const referenceSize = byHeight ? size.y : Math.max(size.x, size.z);
  model.scale.setScalar(referenceSize > 0 ? targetSize / referenceSize : 1);
  model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model);
  // A height-only scale on an arbitrary architectural asset can leave a
  // footprint far wider than intended (e.g. a squat, wide source model
  // scaled up to skyscraper height). Clamp X/Z only, after the height is
  // set, so buildings never bleed into the road or neighbouring blocks.
  if (maxFootprint) {
    const footprintSize = bounds.getSize(new THREE.Vector3());
    const footprint = Math.max(footprintSize.x, footprintSize.z);
    if (footprint > maxFootprint) {
      const footprintScale = maxFootprint / footprint;
      model.scale.x *= footprintScale;
      model.scale.z *= footprintScale;
      model.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(model);
    }
  }
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;
  return container;
}

const streetSignMaterials = new Map<string, THREE.MeshBasicMaterial>();

function streetSign(label: string, background: string, width: number) {
  const key = `${label}:${background}`;
  let material = streetSignMaterials.get(key);
  if (!material) {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff7de';
    context.font = '700 40px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.MeshBasicMaterial({ map: texture });
    streetSignMaterials.set(key, material);
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.3), material);
}

function racerNameplate(name: string, isBot: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 360;
  canvas.height = 92;
  const context = canvas.getContext('2d')!;
  context.fillStyle = isBot ? '#3b4760' : '#123f35';
  context.beginPath();
  context.roundRect(6, 6, 348, 80, 26);
  context.fill();
  context.strokeStyle = isBot ? '#90a7cf' : '#fed36f';
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = '#fff8e6';
  context.font = '700 40px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(name.slice(0, 18), 180, 47);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.75, 0.45, 1);
  sprite.position.y = 3.08;
  return sprite;
}

function addDistrictDetail(group: THREE.Group, district: number, width: number, depth: number, side: number) {
  const front = -depth / 2 - 0.34;
  const nearSide = side > 0 ? -1 : 1;
  if (district === 0) {
    // Market / chai lane: bold signs, striped shade and a few crates make it
    // immediately recognisable from the chase camera.
    const sign = streetSign(width > 5 ? 'KIRANA' : 'CHAI', '#9d352d', Math.min(width * 0.72, 3.5));
    sign.position.set(0, 1.74, front);
    group.add(sign);
    for (const x of [-width * 0.3, 0, width * 0.3]) {
      group.add(box(0.12, 0.48, 0.52, 0xf1d35b, x, 1.1, front - 0.04));
    }
    group.add(box(0.42, 0.32, 0xb9743c, nearSide * width * 0.4, 0.32, front - 0.32));
    group.add(box(0.36, 0.25, 0x557e39, nearSide * width * 0.25, 0.25, front - 0.32));
  } else if (district === 1) {
    // Apartment zone: laundry and planter boxes add lived-in detail without
    // adding animated characters or expensive textures.
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-width * 0.36, 3.45, front), new THREE.Vector3(width * 0.36, 3.45, front)]),
      new THREE.LineBasicMaterial({ color: 0x4d443d })
    );
    group.add(line);
    for (const [x, color] of [[-0.22, 0xe9d8b0], [0, 0x4f91a5], [0.22, 0xd96154]] as const) {
      group.add(box(0.17, 0.28, 0.04, color, x * width, 3.26, front - 0.02));
    }
    group.add(box(width * 0.5, 0.18, 0.38, 0x4d7d3b, 0, 2.1, front - 0.2));
  } else if (district === 2) {
    // Keep construction dressing flush to the facade. Freestanding scaffold
    // bars and hazard boards used to spill into the pavement.
    const sign = streetSign('WORKS', '#e17d27', Math.min(width * 0.5, 2.4));
    sign.position.set(0, 1.42, front - 0.02);
    group.add(sign);
  } else {
    // Transit identity is carried by a facade sign so the footpath remains a
    // clean uninterrupted strip with no canopy posts or benches to clip.
    const sign = streetSign('BUS STOP', '#31586b', 1.45);
    sign.position.set(0, 1.72, front - 0.02);
    group.add(sign);
  }
}

function hideGroundMeshes(root: THREE.Object3D) {
  const worldBox = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    worldBox.setFromObject(child);
    worldBox.getSize(size);
    worldBox.getCenter(center);
    if (size.y < 0.5 && Math.max(size.x, size.z) > 2.2 && center.y < 0.4) child.visible = false;
  });
}

function createRoadsideBlock(index: number, side: number, buildingTemplate?: THREE.Group) {
  const group = new THREE.Group();
  const palettes = [0xe6a15c, 0x75a6a4, 0xd87668, 0xd1b36a, 0x8c83a8, 0xb9c477];
  const awningPalettes = [0xc84636, 0x197c78, 0xe4a12f, 0x4d6094, 0x8c3940];
  const width = 4.2 + (index % 3) * 0.8;
  const depth = 4.5 + ((index + 1) % 3) * 0.9;
  const floors = 2 + (index % 4);
  const height = floors * 1.65;
  const color = palettes[index % palettes.length];
  const awningColor = awningPalettes[index % awningPalettes.length];
  const district = Math.floor(index / 5) % 4;

  if (buildingTemplate) {
    const building = buildingTemplate.clone(true);
    hideGroundMeshes(building);
    group.add(building);
  } else {
    group.add(box(width, height, depth, color, 0, height / 2, 0));
    group.add(box(width + 0.15, 0.18, depth + 0.15, 0x53493e, 0, height + 0.08, 0));
    group.add(box(width * 0.92, 0.44, 0.24, awningColor, 0, 1.18, -depth / 2 - 0.16));
    group.add(box(width * 0.62, 0.27, 0.09, 0x1e2a26, 0, 1.62, -depth / 2 - 0.29));
    group.add(box(0.7, 1.02, 0.08, 0x4f3725, 0, 0.57, -depth / 2 - 0.22));
    group.add(box(0.5, 0.46, 0.09, 0xbde8ed, -width * 0.3, 0.92, -depth / 2 - 0.23));
    group.add(box(0.5, 0.46, 0.09, 0xbde8ed, width * 0.3, 0.92, -depth / 2 - 0.23));

    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xa9e2ed });
    for (let floor = 1; floor < floors; floor += 1) {
      for (const windowX of [-width * 0.25, width * 0.25]) {
        const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.62), windowMaterial);
        windowMesh.position.set(windowX, floor * 1.55 + 0.35, -depth / 2 - 0.011);
        group.add(windowMesh);
      }
    }

    if (floors > 2) {
      const balcony = box(width * 0.68, 0.1, 0.55, 0xf0dfc0, 0, 2.28, -depth / 2 - 0.24);
      group.add(balcony);
      for (const railX of [-width * 0.25, 0, width * 0.25]) group.add(box(0.045, 0.38, 0.045, 0xf0dfc0, railX, 2.48, -depth / 2 - 0.44));
    }
    if (index % 2 === 0) {
      group.add(cylinder(0.42, 0.62, 0x23282b, width * 0.22, height + 0.47, depth * 0.12));
      group.add(cylinder(0.32, 0.08, 0x3d474b, width * 0.22, height + 0.82, depth * 0.12));
    } else {
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xd9ded8 }));
      dish.rotation.x = -0.7;
      dish.position.set(-width * 0.24, height + 0.35, depth * 0.12);
      group.add(dish, box(0.05, 0.45, 0.05, 0x4d5150, -width * 0.24, height + 0.18, depth * 0.12));
    }
    addDistrictDetail(group, district, width, depth, side);
  }

  // A simple tree and lamp make each block read as a lively Indian roadside.
  const treeX = side > 0 ? -width * 0.72 : width * 0.72;
  group.add(box(0.22, 1.6, 0.22, 0x68452f, treeX, 1.02, -depth / 2 - 0.8));
  const crown = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.85, 0),
    new THREE.MeshLambertMaterial({ color: 0x3d773e })
  );
  crown.position.set(treeX, 2.22, -depth / 2 - 0.8);
  group.add(crown);
  group.add(box(0.1, 2.8, 0.1, 0x343b3e, -treeX, 1.5, -depth / 2 - 0.6));
  group.add(box(0.55, 0.14, 0.22, 0xffe7a3, -treeX + side * 0.22, 2.85, -depth / 2 - 0.6));
  if (index % 3 === 0) {
    const stallX = side > 0 ? width * 0.55 : -width * 0.55;
    group.add(box(1.05, 0.82, 0.72, 0x7f5132, stallX, 0.62, -depth / 2 - 0.62));
    group.add(box(1.22, 0.13, 0.9, 0xe2b84d, stallX, 0.98, -depth / 2 - 0.62));
    group.add(cylinder(0.12, 0.22, 0xd9d4bd, stallX - 0.25, 1.16, -depth / 2 - 0.75, 8));
  }
  return group;
}

function createBengaluruBackdrop(index: number, side: number, buildingTemplate?: THREE.Group) {
  const group = new THREE.Group();
  const width = 5.5 + (index % 3) * 1.2;
  const height = 6.5 + (index % 4) * 1.8;
  const depth = 6 + (index % 2) * 1.6;
  const colors = [0x708d8d, 0xc68655, 0x9b755e, 0x80925e, 0x77759a];
  if (buildingTemplate) {
    const building = buildingTemplate.clone(true);
    hideGroundMeshes(building);
    group.add(building);
  } else {
    group.add(box(width, height, depth, colors[index % colors.length], 0, height / 2, 0));
    group.add(box(width + 0.18, 0.18, depth + 0.18, 0x47423c, 0, height + 0.08, 0));
    for (let floor = 1; floor < Math.floor(height / 1.55); floor += 1) {
      group.add(box(width * 0.62, 0.42, 0.05, 0xaed8dd, 0, floor * 1.45 + 0.28, -depth / 2 - 0.03));
    }
  }
  const label = index % 4 === 0 ? 'TECH PARK' : index % 4 === 1 ? 'DARSHINI' : index % 4 === 2 ? 'FILTER COFFEE' : 'METRO';
  const sign = streetSign(label, index % 2 ? '#355e70' : '#7e3f2c', Math.min(width * 0.72, 4.4));
  sign.position.set(0, 1.65, -depth / 2 - 0.08);
  group.add(sign);
  if (index % 3 === 0) {
    group.add(cylinder(0.48, 0.72, 0x24292a, width * 0.22, height + 0.48, 0));
    group.add(cylinder(0.36, 0.08, 0x41494a, width * 0.22, height + 0.86, 0));
  }
  // A row of roadside trees fills the remaining verge with a Bengaluru-like
  // leafy edge around the denser city forms.
  const treeX = side > 0 ? -width * 0.48 : width * 0.48;
  group.add(box(0.18, 2.2, 0.18, 0x67442b, treeX, 1.1, -depth / 2 - 1.15));
  const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.96, 0), new THREE.MeshLambertMaterial({ color: 0x376e3f }));
  crown.position.set(treeX, 2.6, -depth / 2 - 1.15);
  group.add(crown);
  return group;
}

function createLandmark(name: string): THREE.LOD {
  const detailed = new THREE.Group();
  const simple = new THREE.Group();
  const colors = { stone: 0xd8c9a3, red: 0xb74f3e, glass: 0x6ba4b5, blue: 0x285a78 };
  if (name === 'VIDHANA SOUDHA') {
    detailed.add(box(6.8, 2.1, 3.2, colors.stone, 0, 1.05, 0), box(7.8, 0.18, 3.7, colors.stone, 0, 2.2, 0));
    detailed.add(cylinder(1.25, 0.7, colors.stone, 0, 3.05, 0, 16), cylinder(0.34, 1.4, colors.stone, 0, 3.95, 0, 12));
    detailed.add(streetSign('VIDHANA SOUDHA • ವಿಧಾನ ಸೌಧ', '#234d56', 4.8));
    simple.add(box(7, 2.8, 3.2, colors.stone, 0, 1.4, 0));
  } else if (name === 'SILK BOARD') {
    detailed.add(box(9, 0.35, 1.2, colors.blue, 0, 4, 0), box(0.35, 3.8, 0.35, colors.blue, -3.8, 2.2, 0), box(0.35, 3.8, 0.35, colors.blue, 3.8, 2.2, 0));
    detailed.add(streetSign('SILK BOARD • ಸಿಲ್ಕ್ ಬೋರ್ಡ್', '#174c76', 5.5));
    simple.add(box(9, 2.2, 1.5, colors.blue, 0, 1.1, 0));
  } else if (name === 'TRINITY CIRCLE') {
    detailed.add(cylinder(2.3, 0.18, 0xc7a43b, 0, 0.1, 0, 20), cylinder(0.36, 2.5, colors.red, 0, 1.3, 0, 12), box(2.4, 0.32, 0.35, colors.stone, 0, 2.58, 0));
    detailed.add(streetSign('TRINITY CIRCLE • ಟ್ರಿನಿಟಿ', '#245875', 4.2));
    simple.add(cylinder(1.8, 0.2, colors.red, 0, 0.1, 0, 12));
  } else if (name === 'ECOSPACE') {
    for (const x of [-2.6, 0, 2.6]) detailed.add(box(2.2, 7, 2.3, colors.glass, x, 3.5, 0));
    detailed.add(streetSign('ORR TECH CORRIDOR • ಹೊರ ವರ್ತುಲ ರಸ್ತೆ', '#1d5263', 6));
    simple.add(box(8, 6, 2.2, colors.glass, 0, 3, 0));
  } else {
    detailed.add(box(7, 2.8, 3, colors.red, 0, 1.4, 0));
    simple.add(box(7, 2.8, 3, colors.red, 0, 1.4, 0));
  }
  const lod = new THREE.LOD();
  lod.addLevel(detailed, 0);
  lod.addLevel(simple, 58);
  return lod;
}

export function GameScene({ myPlayerId, profiles, positions, obstacles, attackEvents, input, onReady }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const profilesRef = useRef(profiles);
  const positionsRef = useRef(positions);
  const obstaclesRef = useRef(obstacles);
  const attackEventsRef = useRef(attackEvents);
  const onReadyRef = useRef(onReady);

  profilesRef.current = profiles;
  positionsRef.current = positions;
  obstaclesRef.current = obstacles;
  attackEventsRef.current = attackEvents;
  onReadyRef.current = onReady;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let readySignaled = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let animationFrame = 0;
    const signalReady = () => {
      if (disposed || readySignaled) return;
      readySignaled = true;
      onReadyRef.current();
    };

    async function setup() {
      if (disposed || !mount) return;
      const quality = (() => {
        const forced = new URLSearchParams(window.location.search).get('quality');
        if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
        const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
        return mount.clientWidth < 500 || navigator.hardwareConcurrency <= 4 || deviceMemory <= 4
          ? 'low' as const
          : 'medium' as const;
      })();

      // Mirrors the server's laneCountFor/roadHalfWidthFor (spacetimedb/src/index.ts):
      // the drivable width grows with field size, so every fixed x-offset below
      // (road, ground collider, sidewalks, roadside blocks) is expressed relative
      // to this instead of the old static 3-lane numbers, to stay in sync.
      const roadHalfWidth = roadHalfWidthFor(profiles.length);
      const baselineHalfWidth = 4.65;
      const laneGrowth = roadHalfWidth - baselineHalfWidth;

      const scene = new THREE.Scene();
      const skyColor = new THREE.Color(0xe9a86f);
      scene.background = skyColor;
      scene.fog = new THREE.Fog(0xe9b984, 52, 145);
      const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 180);
      camera.position.set(0, 6.4, 12);
      camera.lookAt(0, 1.15, -2);

      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      // Three.js r185 uses physically correct lighting by default.
      renderer.shadowMap.enabled = quality !== 'low';
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.setPixelRatio(Math.min(devicePixelRatio, mount.clientWidth < 760 ? 1.25 : 1.5));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      const hemi = new THREE.HemisphereLight(0xffd8b0, 0x3d5b35, 1.9);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffc26e, 3.3);
      sun.position.set(-8, 18, 10);
      sun.castShadow = quality !== 'low';
      sun.shadow.mapSize.set(quality === 'high' ? 1024 : 512, quality === 'high' ? 1024 : 512);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 72;
      sun.shadow.camera.left = -18;
      sun.shadow.camera.right = 18;
      sun.shadow.camera.top = 18;
      sun.shadow.camera.bottom = -18;
      scene.add(sun);
      const sunDisk = new THREE.Mesh(
        new THREE.CircleGeometry(8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false })
      );
      sunDisk.position.set(-27, 23, -125);
      sunDisk.lookAt(camera.position);
      scene.add(sunDisk);

      // High quality adds a deliberately restrained bloom pass. Medium keeps
      // the lighting and soft shadows but avoids the extra full-screen pass.
      let composer: EffectComposer | undefined;
      if (quality === 'high') {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.22, 0.38, 0.9));
      }

      // Kept as a hook for a branded LUT asset later. The ACES curve provides
      // a good neutral grade today without shipping a large 3D texture.
      const setColourGradeLut = (lut?: THREE.Texture | THREE.Data3DTexture) => {
        scene.userData.colourGradeLut = lut;
      };
      setColourGradeLut();

      const assetLoader = new GLTFLoader();
      const textureLoader = new THREE.TextureLoader();
      const trafficPromise = Promise.all(TRAFFIC_ASSETS.map(async (url, index) => {
        try {
          const asset = await withTimeout(assetLoader.loadAsync(url), ASSET_LOAD_MS, url);
          stripTrafficDecor(asset.scene);
          return normalizeAsset(asset.scene, index === 2 || index === 4 ? 4.8 : 3.8);
        } catch (error) {
          console.warn(`Could not load traffic asset ${url}; using fallback model.`, error);
          return undefined;
        }
      }));
      const buildingsPromise = quality === 'low' ? Promise.resolve([]) : Promise.all(BUILDING_ASSETS.map(async url => {
        try {
          const asset = await withTimeout(assetLoader.loadAsync(url), ASSET_LOAD_MS, url);
          // These PBR materials ship metallic trim/glass values authored for a
          // scene with a reflection probe. With no envMap here, metalness
          // reads as near-black except for one glary highlight — cap it so
          // windows/trim look like matte painted panels instead of mirrors.
          asset.scene.traverse(child => {
            if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
              child.material.metalness = Math.min(child.material.metalness, 0.15);
            }
            // Cars and traffic already respect quality-gated shadows (see
            // ensureCar/ensureObstacle below); these were the one visible
            // gap where the road casts/receives shadows but the buildings
            // lining it never do, at any quality tier.
            if (child instanceof THREE.Mesh) {
              child.castShadow = quality === 'high';
              child.receiveShadow = true;
            }
          });
          return asset.scene;
        } catch (error) {
          console.warn(`Could not load building asset ${url}; using fallback model.`, error);
          return undefined;
        }
      }));
      const loadTexture = async (url: string) => {
        try {
          return await withTimeout(textureLoader.loadAsync(url), ASSET_LOAD_MS, url);
        } catch (error) {
          console.warn(`Could not load road texture ${url}; using material fallback.`, error);
          return undefined;
        }
      };
      const roadTexturesPromise = Promise.all([
        loadTexture('/assets/quaternius/downtown-citymegakit/Textures/T_Concrete_Asphalt_BaseColor.png'),
        loadTexture('/assets/quaternius/downtown-citymegakit/Textures/T_Concrete_Normal.png'),
        loadTexture('/assets/quaternius/downtown-citymegakit/Textures/T_Concrete_ORM.png'),
      ]);
      // Required assets load concurrently. Each failure resolves to a valid
      // procedural/material fallback before the first ready frame is reported.
      const [trafficTemplates, rawBuildingScenes, roadTextures] = await Promise.all([
        trafficPromise,
        buildingsPromise,
        roadTexturesPromise,
      ]);
      if (disposed) { composer?.dispose(); return; }
      // Near-field (roadside) buildings stay shorter than far-field (skyline)
      // ones so the two layers keep their existing depth cue.
      const nearHeights = [4.5, 6.5, 8.5];
      const farHeights = [11, 15, 20];
      const buildingTemplatesNear = rawBuildingScenes
        .map((scene, i) => (scene ? normalizeAsset(scene, nearHeights[i % nearHeights.length], true, 6.5) : undefined))
        .filter((t): t is THREE.Group => !!t);
      const buildingTemplatesFar = rawBuildingScenes
        .map((scene, i) => (scene ? normalizeAsset(scene, farHeights[i % farHeights.length], true, 8.5) : undefined))
        .filter((t): t is THREE.Group => !!t);

      const [roadColorMap, roadNormalMap, roadOrmMap] = roadTextures;
      // Road plane is 13 wide x 260 long; ~2.6 units per tile keeps the
      // asphalt grain from looking stretched at chase-cam distance.
      for (const map of [roadColorMap, roadNormalMap, roadOrmMap]) {
        if (!map) continue;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(5, 100);
      }
      if (roadColorMap) roadColorMap.colorSpace = THREE.SRGBColorSpace;
      const roadMaterial = new THREE.MeshStandardMaterial({
        map: roadColorMap,
        normalMap: roadNormalMap,
        aoMap: roadOrmMap,
        roughnessMap: roadOrmMap,
        metalnessMap: roadOrmMap,
        color: 0x343b3e,
        roughness: 0.76,
        metalness: 0.02,
      });
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(roadHalfWidth * 2, 260, 1, 1),
        roadMaterial
      );
      // aoMap needs a second UV channel; reuse uv since the ORM texture is
      // tiled identically to the color map.
      road.geometry.setAttribute('uv2', road.geometry.attributes.uv);
      road.rotation.x = -Math.PI / 2;
      road.position.z = -95;
      road.receiveShadow = quality !== 'low';
      scene.add(road);

      // Sparse dark pothole decals, generated at runtime so no extra asset
      // files are needed. A radial gradient reads as a shallow depression
      // with a faint rim highlight at chase-cam distance.
      const potholeCanvas = document.createElement('canvas');
      potholeCanvas.width = potholeCanvas.height = 128;
      const potholeContext = potholeCanvas.getContext('2d')!;
      const potholeGradient = potholeContext.createRadialGradient(64, 64, 6, 64, 64, 62);
      potholeGradient.addColorStop(0, 'rgba(10,10,10,0.92)');
      potholeGradient.addColorStop(0.68, 'rgba(18,18,18,0.75)');
      potholeGradient.addColorStop(0.82, 'rgba(90,84,72,0.35)');
      potholeGradient.addColorStop(1, 'rgba(90,84,72,0)');
      potholeContext.fillStyle = potholeGradient;
      potholeContext.fillRect(0, 0, 128, 128);
      const potholeTexture = new THREE.CanvasTexture(potholeCanvas);
      potholeTexture.colorSpace = THREE.SRGBColorSpace;
      const potholeMaterial = new THREE.MeshBasicMaterial({ map: potholeTexture, transparent: true, depthWrite: false });
      const potholes: Array<{ mesh: THREE.Mesh; baseZ: number }> = [];
      if (quality !== 'low') {
        // One every ~15-25m per lane band, deterministic so it doesn't
        // jitter between renders; skipped entirely on low quality.
        const laneXs = [-3.2, -1.6, 0, 1.6, 3.2];
        let seed = 0;
        for (let z = -205; z < 20; z += 18) {
          seed += 1;
          if (seed % 3 === 0) continue; // keep them sparse, not on every band
          const x = laneXs[seed % laneXs.length];
          const size = 0.9 + (seed % 3) * 0.25;
          const pothole = new THREE.Mesh(new THREE.PlaneGeometry(size, size), potholeMaterial);
          pothole.rotation.x = -Math.PI / 2;
          pothole.rotation.z = seed * 0.6;
          pothole.position.set(x, 0.014, z);
          scene.add(pothole);
          potholes.push({ mesh: pothole, baseZ: z });
        }
      }

      const rainDrops = 220;
      const rainPositions = new Float32Array(rainDrops * 6);
      for (let index = 0; index < rainDrops; index += 1) {
        const offset = index * 6;
        const x = ((index * 37) % 150) / 10 - 7.5;
        const y = ((index * 47) % 100) / 10;
        const z = -((index * 83) % 160);
        rainPositions[offset] = rainPositions[offset + 3] = x;
        rainPositions[offset + 1] = y;
        rainPositions[offset + 4] = y + 0.3;
        rainPositions[offset + 2] = rainPositions[offset + 5] = z;
      }
      const rainGeometry = new THREE.BufferGeometry();
      rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
      const rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xc9e8ff, transparent: true, opacity: 0.58, depthWrite: false }));
      rain.visible = false;
      scene.add(rain);
      let weather = initialWeather();
      let lastEnvironmentMinute = -1;
      let lastEnvironmentWeather: Weather | undefined;
      // This is the scene-side weather-state hook. Event integrations can set
      // `detail.weather` to `rain` without coupling visuals to race logic.
      const onWeatherChange = (event: Event) => {
        const next = (event as CustomEvent<{ weather?: Weather }>).detail?.weather;
        if (next === 'clear' || next === 'rain') weather = next;
      };
      window.addEventListener('jaldi-weather', onWeatherChange as EventListener);
      const applyEnvironment = () => {
        const now = new Date();
        const minute = now.getHours() * 60 + now.getMinutes();
        if (minute === lastEnvironmentMinute && weather === lastEnvironmentWeather) return;
        lastEnvironmentMinute = minute;
        lastEnvironmentWeather = weather;
        const phase = timeOfDay(now.getHours() + now.getMinutes() / 60);
        const rainy = weather === 'rain';
        const settings = phase === 'morning'
          ? { sky: 0x9fc5dd, fog: 0xa9c7d7, sun: 0xc4dbef, sunPower: 2.2, hemi: 1.55, exposure: 0.96, shadow: 4.5, sunY: 12 }
          : phase === 'noon'
            ? { sky: 0x80c5e8, fog: 0xa9d2e1, sun: 0xfff3c7, sunPower: 3.8, hemi: 2.4, exposure: 1.08, shadow: 1.2, sunY: 24 }
            : phase === 'evening'
              ? { sky: 0xe9a86f, fog: 0xe9b984, sun: 0xffc26e, sunPower: 3.3, hemi: 1.9, exposure: 1, shadow: 3.8, sunY: 18 }
              : { sky: 0xe9a86f, fog: 0xe9b984, sun: 0xffc26e, sunPower: 3.3, hemi: 1.9, exposure: 1, shadow: 3.8, sunY: 18 };
        skyColor.setHex(rainy ? settings.sky * 0.67 : settings.sky);
        (scene.fog as THREE.Fog).color.setHex(rainy ? settings.fog * 0.6 : settings.fog);
        (scene.fog as THREE.Fog).near = rainy ? 36 : 52;
        (scene.fog as THREE.Fog).far = rainy ? 118 : 145;
        sun.color.setHex(settings.sun);
        sun.intensity = settings.sunPower * (rainy ? 0.55 : 1);
        sun.position.y = settings.sunY;
        sun.shadow.radius = settings.shadow;
        hemi.intensity = settings.hemi * (rainy ? 0.68 : 1);
        hemi.color.setHex(settings.sky);
        sunDisk.visible = true;
        // Textured material now carries the base grey via its map; weather
        // still darkens/lightens it by tinting on top of that texture.
        roadMaterial.color.setHex(rainy ? 0x202a30 : 0x343b3e);
        roadMaterial.roughness = rainy ? 0.24 : 0.76;
        roadMaterial.metalness = rainy ? 0.28 : 0.02;
        rain.visible = rainy;
        renderer!.toneMappingExposure = settings.exposure;
      };
      applyEnvironment();

      // Lay curb → sidewalk → grass as non-overlapping strips from the asphalt
      // edge outward. Overlapping near-coplanar planes were z-fighting into
      // black flickering bands down the pavement.
      const asphaltEdge = roadHalfWidth;
      const gutter = 0.14;
      const curbWidth = 0.28;
      const sidewalkWidth = 3.9;
      const vergeWidth = 28;
      const curbMaterial = new THREE.MeshLambertMaterial({
        color: 0xe3d3a5,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const sidewalkMaterial = new THREE.MeshLambertMaterial({
        color: 0xc8baa1,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const vergeMaterial = new THREE.MeshLambertMaterial({ color: 0x527b3e });
      const addGroundStrip = (width: number, material: THREE.Material, x: number, y: number) => {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, 260), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y, -95);
        mesh.receiveShadow = false;
        mesh.renderOrder = 1;
        scene.add(mesh);
      };
      for (const side of [-1, 1]) {
        const curbInner = asphaltEdge + gutter;
        addGroundStrip(curbWidth, curbMaterial, side * (curbInner + curbWidth / 2), 0.04);
        const walkInner = curbInner + curbWidth + 0.06;
        addGroundStrip(sidewalkWidth, sidewalkMaterial, side * (walkInner + sidewalkWidth / 2), 0.055);
        const vergeInner = walkInner + sidewalkWidth + 0.08;
        addGroundStrip(vergeWidth, vergeMaterial, side * (vergeInner + vergeWidth / 2), -0.02);
      }
      const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf3e8bd });
      const roadMarkers: Array<{ mesh: THREE.Mesh; baseZ: number }> = [];
      for (const x of [-1.6, 1.6]) {
        for (let z = -210; z < 30; z += 10) {
          const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5), stripeMaterial);
          stripe.rotation.x = -Math.PI / 2;
          stripe.position.set(x, 0.03, z);
          scene.add(stripe);
          roadMarkers.push({ mesh: stripe, baseZ: z });
        }
      }

      const routeLandmarks: Array<{ object: THREE.LOD; baseDistance: number }> = [];
      for (const zone of CITY_ROUTE_ZONES) {
        const landmark = createLandmark(zone.landmark);
        // The widest landmark (SILK BOARD) has a ~9-unit footprint; anchoring
        // at 12.5 keeps every landmark's inner edge clear of the 13-wide road
        // (±6.5) instead of sitting on top of the driving lanes.
        const landmarkX = 12.5 + laneGrowth;
        landmark.position.set(zone.id === 'orr' || zone.id === 'cbd' ? -landmarkX : landmarkX, 0, 0);
        scene.add(landmark);
        routeLandmarks.push({ object: landmark, baseDistance: zone.start + 34 });
      }
      // Keep Namma Metro beyond the finished footpath. Its pillars and beam
      // remain visible as skyline dressing without clipping the walk strip.
      const metro = new THREE.Group();
      const pillarGeometry = new THREE.CylinderGeometry(0.16, 0.2, 4.2, 8);
      const pillarMaterial = new THREE.MeshLambertMaterial({ color: 0x7d8583 });
      const beamMaterial = new THREE.MeshLambertMaterial({ color: 0x626e70 });
      const pillars = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, 22);
      const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1.35, 0.38, 27), beamMaterial, 22);
      const pillarMatrix = new THREE.Matrix4();
      const beamMatrix = new THREE.Matrix4();
      for (let index = 0; index < 22; index += 1) {
        pillarMatrix.makeTranslation(0, 2.1, -index * 28);
        pillars.setMatrixAt(index, pillarMatrix);
        beamMatrix.makeTranslation(0, 4.35, -index * 28 - 14);
        beams.setMatrixAt(index, beamMatrix);
      }
      metro.add(pillars, beams);
      metro.position.x = roadHalfWidth + gutter + curbWidth + sidewalkWidth + 3.2;
      scene.add(metro);
      // Sparse crossings and speed-breaker markings make the street feel
      // inhabited while preserving a clear, readable driving line.
      const roadDetails: Array<{ mesh: THREE.Mesh; baseZ: number }> = [];
      for (let z = -205; z < 20; z += 54) {
        for (const x of [-4.6, -3.45, -2.3, -1.15, 0, 1.15, 2.3, 3.45, 4.6]) {
          const crossing = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.05), stripeMaterial);
          crossing.rotation.x = -Math.PI / 2;
          crossing.position.set(x, 0.016, z);
          scene.add(crossing);
          roadDetails.push({ mesh: crossing, baseZ: z });
        }
      }

      const roadsideBlocks: Array<{ group: THREE.Group; baseDistance: number }> = [];
      const blockSpacing = 13;
      const blockLoop = 26 * blockSpacing;
      for (const side of [-1, 1]) {
        for (let index = 0; index < 26; index += 1) {
          const roadsideIndex = index + (side > 0 ? 3 : 0);
          const roadsideTemplate = buildingTemplatesNear.length
            ? buildingTemplatesNear[roadsideIndex % buildingTemplatesNear.length]
            : undefined;
          const group = createRoadsideBlock(roadsideIndex, side, roadsideTemplate);
          group.position.x = side * (13.8 + laneGrowth + (index % 3) * 0.7);
          group.rotation.y = side > 0 ? -0.012 : 0.012;
          scene.add(group);
          roadsideBlocks.push({ group, baseDistance: index * blockSpacing + (side > 0 ? blockSpacing / 2 : 0) });
        }
      }
      // A second, taller city layer occupies the former empty grass field. It
      // is intentionally set back behind the walkable pavement so the road is
      // still readable and the player keeps a broad horizon.
      const skylineBlocks: Array<{ group: THREE.Group; baseDistance: number }> = [];
      const skylineSpacing = 26;
      const skylineLoop = 13 * skylineSpacing;
      for (const side of [-1, 1]) {
        for (let index = 0; index < 13; index += 1) {
          const skylineIndex = index + (side > 0 ? 2 : 0);
          const skylineTemplate = buildingTemplatesFar.length
            ? buildingTemplatesFar[skylineIndex % buildingTemplatesFar.length]
            : undefined;
          const group = createBengaluruBackdrop(skylineIndex, side, skylineTemplate);
          group.position.x = side * (18.5 + laneGrowth + (index % 2) * 1.5);
          group.rotation.y = side > 0 ? -0.06 : 0.06;
          scene.add(group);
          skylineBlocks.push({ group, baseDistance: index * skylineSpacing + (side > 0 ? skylineSpacing / 2 : 0) });
        }
      }
      // Local prediction matches the server arcade tick: auto-throttle
      // forward, left/right as a strafe. A Rapier yawing chassis was slamming
      // into the curb and zeroing velocity at the wall.
      const carMeshes = new Map<string, THREE.Group>();
      const obstacleMeshes = new Map<string, THREE.Group>();
      const retiringObstacles = new Map<string, { startedAt: number; direction: number }>();
      // Keep completed retirements suppressed until the authoritative row is
      // deleted. Without this tombstone, an inactive row outlives the 900ms
      // animation and ensureObstacle recreates the same vehicle for a second
      // knock-aside exit.
      const retiredObstacleKeys = new Set<string>();
      const seenAttackAnimations = new Set<string>();
      const attackAnimations: Array<{
        attackerPlayerId: bigint;
        targetPlayerId: bigint;
        kind: string;
        startedAt: number;
        direction: number;
      }> = [];
      const onLocalAttack = (event: Event) => {
        const detail = (event as CustomEvent<{
          attackerPlayerId: bigint;
          targetPlayerId: bigint;
          attackKind: string;
        }>).detail;
        if (!detail) return;
        const attacker = positionsRef.current.find(position => position.playerId === detail.attackerPlayerId);
        const target = positionsRef.current.find(position => position.playerId === detail.targetPlayerId);
        const lateralDifference = (target?.x ?? 0) - (attacker?.x ?? 0);
        attackAnimations.push({
          attackerPlayerId: detail.attackerPlayerId,
          targetPlayerId: detail.targetPlayerId,
          kind: detail.attackKind,
          startedAt: performance.now(),
          direction: Math.sign(lateralDifference) || (detail.targetPlayerId % 2n === 0n ? 1 : -1),
        });
      };
      window.addEventListener('jaldi-attack-activated', onLocalAttack as EventListener);
      let physicsAccumulator = 0;
      const fixedPhysicsStep = 1 / 60;
      const arcade: ArcadeDriveState = { x: 0, distance: 0, speed: 0 };
      let arcadeReady = false;
      let previousPhysicsX = 0;
      let previousPhysicsZ = 0;
      let currentPhysicsX = 0;
      let currentPhysicsZ = 0;
      const liveRoadHalfWidth = () => roadHalfWidthFor(Math.max(1, profilesRef.current.length));
      const myVehicleType = () => profilesRef.current.find(p => p.playerId === myPlayerId)?.vehicleType ?? 'auto';

      const stepLocalVehicle = () => {
        if (!arcadeReady) return;
        previousPhysicsX = currentPhysicsX;
        previousPhysicsZ = currentPhysicsZ;
        stepArcadeDrive(
          arcade,
          { steering: input.current.steering, throttle: input.current.throttle, boost: input.current.boost },
          myVehicleType(),
          fixedPhysicsStep,
          liveRoadHalfWidth(),
        );
        currentPhysicsX = arcade.x;
        currentPhysicsZ = -arcade.distance;
      };

      const ensureCar = (profile: Profile, initialX: number, initialZ: number) => {
        const key = profile.playerId.toString();
        if (carMeshes.has(key)) return;
        const group = createPlayerVehicle(profile);
        if (quality !== 'low') group.traverse(child => {
          if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        group.add(racerNameplate(profile.name, profile.isBot));
        group.position.set(initialX, 0, initialZ);
        scene.add(group);
        carMeshes.set(key, group);
      };

      const ensureObstacle = (obstacle: Obstacle, initialZ: number) => {
        const key = obstacle.obstacleId.toString();
        if (obstacleMeshes.has(key) || retiredObstacleKeys.has(key)) return;
        const kind = obstacle.kind ?? 'traffic';
        const variant = Number(obstacle.obstacleId % BigInt(trafficTemplates.length));
        let mesh: THREE.Group;
        if (kind === 'powerup') {
          mesh = createHeartPickup();
        } else if (kind === 'pedestrian') {
          mesh = createPedestrian(variant);
        } else if (kind === 'police') {
          mesh = trafficTemplates[5]?.clone(true) ?? createPoliceCar();
          markKenneyWheels(mesh);
          if (!mesh.userData.policeLights) addPoliceLights(mesh, 1.55);
          mesh.userData.kind = 'police';
        } else {
          const carVariant = variant === 5 ? 0 : variant;
          mesh = trafficTemplates[carVariant]?.clone(true) ?? createTrafficVehicle(carVariant);
          markKenneyWheels(mesh);
          mesh.userData.kind = 'traffic';
        }
        if (quality !== 'low') mesh.traverse(child => {
          if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        mesh.position.set(obstacle.x, 0, initialZ);
        scene.add(mesh);
        obstacleMeshes.set(key, mesh);
      };
      const recentCarHits = new Map<string, number>();
      const raceStartedAt = performance.now();

      let previous = performance.now();
      let predictedX: number | undefined;
      let predictedDistance: number | undefined;
      const positionsByPlayer = new Map<bigint, Position>();
      let firstFrameRendered = false;
      const render = (now: number) => {
        if (disposed || !renderer) return;
        const dt = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        const authoritativeMe = positionsRef.current.find(row => row.playerId === myPlayerId);
        if (authoritativeMe) {
          if (!arcadeReady) {
            arcade.x = authoritativeMe.x;
            arcade.distance = authoritativeMe.distance;
            arcade.speed = authoritativeMe.speed ?? 0;
            previousPhysicsX = currentPhysicsX = arcade.x;
            previousPhysicsZ = currentPhysicsZ = -arcade.distance;
            arcadeReady = true;
          } else if (Math.abs(arcade.x - authoritativeMe.x) > 5 || Math.abs(arcade.distance - authoritativeMe.distance) > 12) {
            arcade.x = authoritativeMe.x;
            arcade.distance = authoritativeMe.distance;
            arcade.speed = authoritativeMe.speed ?? arcade.speed;
            previousPhysicsX = currentPhysicsX = arcade.x;
            previousPhysicsZ = currentPhysicsZ = -arcade.distance;
          } else {
            arcade.x += (authoritativeMe.x - arcade.x) * Math.min(1, 4 * dt);
            arcade.distance += (authoritativeMe.distance - arcade.distance) * Math.min(1, 4 * dt);
            arcade.speed += ((authoritativeMe.speed ?? arcade.speed) - arcade.speed) * Math.min(1, 3 * dt);
          }
        }
        physicsAccumulator += dt;
        while (physicsAccumulator >= fixedPhysicsStep) {
          stepLocalVehicle();
          physicsAccumulator -= fixedPhysicsStep;
        }
        if (arcadeReady) {
          const alpha = physicsAccumulator / fixedPhysicsStep;
          predictedX = THREE.MathUtils.lerp(previousPhysicsX, currentPhysicsX, alpha);
          predictedDistance = -THREE.MathUtils.lerp(previousPhysicsZ, currentPhysicsZ, alpha);
        } else {
          predictedX = authoritativeMe?.x ?? 0;
          predictedDistance = authoritativeMe?.distance ?? 0;
        }
        const myDistance = predictedDistance;
        applyEnvironment();
        if (rain.visible) {
          // Typed-array rain is camera-relative and reused every frame: no
          // particle objects, no garbage collection spikes on phones.
          for (let index = 0; index < rainPositions.length; index += 6) {
            rainPositions[index + 1] -= dt * 16;
            if (rainPositions[index + 1] < 0) rainPositions[index + 1] += 10;
            rainPositions[index + 4] = rainPositions[index + 1] + 0.3;
          }
          rainGeometry.attributes.position.needsUpdate = true;
          rain.position.x = camera.position.x;
          rain.position.z = camera.position.z - 55;
        }

        positionsByPlayer.clear();
        for (const position of positionsRef.current) positionsByPlayer.set(position.playerId, position);
        for (const profile of profilesRef.current) {
          const position = positionsByPlayer.get(profile.playerId);
          if (!position) continue;
          const initialX = profile.playerId === myPlayerId ? predictedX : position.x;
          const initialZ = profile.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          ensureCar(profile, initialX, initialZ);
        }

        for (const event of attackEventsRef.current) {
          const key = `${event.attackerPlayerId}-${event.targetPlayerId}-${event.createdAt.toMillis()}`;
          if (seenAttackAnimations.has(key)) continue;
          seenAttackAnimations.add(key);
          const attacker = positionsByPlayer.get(event.attackerPlayerId);
          const target = positionsByPlayer.get(event.targetPlayerId);
          const lateralDifference = (target?.x ?? 0) - (attacker?.x ?? 0);
          attackAnimations.push({
            attackerPlayerId: event.attackerPlayerId,
            targetPlayerId: event.targetPlayerId,
            kind: event.attackKind,
            startedAt: now,
            direction: Math.sign(lateralDifference) || (event.targetPlayerId % 2n === 0n ? 1 : -1),
          });
        }

        const targetImpulses = new Map<bigint, number>();
        const targetTilts = new Map<bigint, number>();
        const attackerLurches = new Map<bigint, number>();
        for (const mesh of carMeshes.values()) {
          const leftLeg = mesh.userData.attackLegLeft as THREE.Group | undefined;
          const rightLeg = mesh.userData.attackLegRight as THREE.Group | undefined;
          for (const leg of [leftLeg, rightLeg]) {
            if (!leg) continue;
            leg.rotation.set(0, 0, 0);
            leg.visible = !leg.userData.attackOnly;
          }
          const damageFx = mesh.userData.damageFx as THREE.Group | undefined;
          if (damageFx) damageFx.visible = false;
        }
        for (let index = attackAnimations.length - 1; index >= 0; index -= 1) {
          const animation = attackAnimations[index];
          const age = now - animation.startedAt;
          const duration = animation.kind === 'ram' ? 1500 : 1100;
          if (age >= duration) {
            attackAnimations.splice(index, 1);
            continue;
          }
          const progress = age / duration;
          const impact = Math.sin(Math.PI * progress);
          const pushDistance = animation.kind === 'ram' ? 1.65 : 1.1;
          targetImpulses.set(animation.targetPlayerId, animation.direction * pushDistance * impact);
          targetTilts.set(animation.targetPlayerId, -animation.direction * (animation.kind === 'ram' ? 0.28 : 0.18) * impact);

          const attackerMesh = carMeshes.get(animation.attackerPlayerId.toString());
          if (animation.kind === 'ram') {
            attackerLurches.set(animation.attackerPlayerId, -0.62 * Math.sin(Math.PI * Math.min(1, age / 440)));
            const targetMesh = carMeshes.get(animation.targetPlayerId.toString());
            const damageFx = targetMesh?.userData.damageFx as THREE.Group | undefined;
            if (damageFx && age < 1250) {
              damageFx.visible = true;
              damageFx.scale.setScalar(0.9 + Math.sin(age * 0.018) * 0.1);
            }
          } else if (attackerMesh && age < 520) {
            const leg = (animation.direction > 0
              ? attackerMesh.userData.attackLegRight
              : attackerMesh.userData.attackLegLeft) as THREE.Group | undefined;
            if (leg) {
              leg.visible = true;
              const kick = Math.sin(Math.PI * age / 520);
              leg.rotation.z = animation.direction * kick * 1.42;
              leg.rotation.x = -kick * 0.72;
            }
          }
        }

        for (const position of positionsRef.current) {
          const key = position.playerId.toString();
          const mesh = carMeshes.get(key);
          if (!mesh) continue;
          const targetX = position.playerId === myPlayerId ? predictedX : position.x;
          const targetZ = position.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          const attackOffset = targetImpulses.get(position.playerId) ?? 0;
          const attackLurch = attackerLurches.get(position.playerId) ?? 0;
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX + attackOffset, 11, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ + attackLurch, 9, dt);
          const visualSteering = position.playerId === myPlayerId ? input.current.steering : position.steering;
          mesh.rotation.y = THREE.MathUtils.damp(mesh.rotation.y, -visualSteering * 0.13, 10, dt);
          mesh.rotation.z = THREE.MathUtils.damp(mesh.rotation.z, -visualSteering * 0.07 + (targetTilts.get(position.playerId) ?? 0), 10, dt);
        }

        // A removed vehicle gets a brief client-only exit animation if it was
        // visible. Pickups can disappear immediately; off-camera hazards are
        // removed directly to keep the object count bounded.
        const liveObstacleKeys = new Set(obstaclesRef.current.map(row => row.obstacleId.toString()));
        for (const key of retiredObstacleKeys) {
          if (!liveObstacleKeys.has(key)) retiredObstacleKeys.delete(key);
        }
        for (const [key, mesh] of obstacleMeshes) {
          if (liveObstacleKeys.has(key)) continue;
          if (retiringObstacles.has(key)) continue;
          const kind = mesh.userData.kind ?? 'traffic';
          const visibleToPlayer = mesh.visible && mesh.position.z > -115 && mesh.position.z < 30;
          if (kind === 'powerup' || kind === 'pedestrian' || !visibleToPlayer) {
            scene.remove(mesh);
            obstacleMeshes.delete(key);
          } else {
            retiringObstacles.set(key, {
              startedAt: now,
              direction: Math.sign(mesh.position.x) || (Number(key) % 2 === 0 ? 1 : -1),
            });
          }
        }

        for (const current of obstaclesRef.current) {
          ensureObstacle(current, 4 - (current.distance - myDistance));
          const key = current.obstacleId.toString();
          const mesh = obstacleMeshes.get(key);
          if (!mesh) continue;
          const kind = current.kind ?? mesh.userData.kind ?? 'traffic';
          if (!current.active) {
            if (kind === 'powerup' || kind === 'pedestrian') {
              scene.remove(mesh);
              obstacleMeshes.delete(key);
              retiredObstacleKeys.add(key);
            } else if (!retiringObstacles.has(key)) {
              retiringObstacles.set(key, {
                startedAt: now,
                direction: Math.sign(mesh.position.x) || (Number(current.obstacleId % 2n) === 0 ? 1 : -1),
              });
            }
            continue;
          }
          retiringObstacles.delete(key);
          const targetX = current.x;
          const targetZ = 4 - (current.distance - myDistance);
          mesh.visible = true;
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 14, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 12, dt);
          if (kind === 'pedestrian') {
            const walk = now * 0.012;
            mesh.rotation.y = THREE.MathUtils.damp(mesh.rotation.y, targetX >= mesh.position.x ? Math.PI / 2 : -Math.PI / 2, 8, dt);
            mesh.position.y = Math.abs(Math.sin(walk)) * 0.06;
            const parts = mesh.userData.walkParts as { leftLeg: THREE.Mesh; rightLeg: THREE.Mesh; leftArm: THREE.Mesh; rightArm: THREE.Mesh } | undefined;
            if (parts) {
              parts.leftLeg.rotation.x = Math.sin(walk) * 0.55;
              parts.rightLeg.rotation.x = Math.sin(walk + Math.PI) * 0.55;
              parts.leftArm.rotation.x = Math.sin(walk + Math.PI) * 0.4;
              parts.rightArm.rotation.x = Math.sin(walk) * 0.4;
            }
          } else if (kind === 'powerup') {
            mesh.position.y = 0.25 + Math.sin(now * 0.005) * 0.12;
            mesh.rotation.y += dt * 2.2;
          } else {
            mesh.rotation.y = Math.PI;
            spinWheels(mesh, dt * 14);
            if (kind === 'police' && Array.isArray(mesh.userData.policeLights)) {
              const on = Math.floor(now / 140) % 2 === 0;
              mesh.userData.policeLights[0].visible = on;
              mesh.userData.policeLights[1].visible = !on;
            }
          }
        }

        for (const [key, retirement] of retiringObstacles) {
          const mesh = obstacleMeshes.get(key);
          if (!mesh) {
            retiringObstacles.delete(key);
            continue;
          }
          const progress = (now - retirement.startedAt) / 900;
          if (progress >= 1) {
            scene.remove(mesh);
            obstacleMeshes.delete(key);
            retiringObstacles.delete(key);
            retiredObstacleKeys.add(key);
            continue;
          }
          mesh.visible = true;
          mesh.position.x += retirement.direction * dt * (2.2 + progress * 4.8);
          mesh.position.z += dt * 10;
          mesh.position.y = -progress * 0.18;
          mesh.rotation.z = retirement.direction * progress * 0.62;
          spinWheels(mesh, dt * 10);
        }

        const carList = now - raceStartedAt < 1600 ? [] : [...carMeshes.values()];
        for (let i = 0; i < carList.length; i += 1) {
          for (let j = i + 1; j < carList.length; j += 1) {
            const a = carList[i];
            const b = carList[j];
            if (Math.abs(a.position.x - b.position.x) > 1.7 || Math.abs(a.position.z - b.position.z) > 2.1) continue;
            const pair = `${Math.min(Number(a.id), Number(b.id))}-${Math.max(Number(a.id), Number(b.id))}`;
            if (now - (recentCarHits.get(pair) ?? 0) < 700) continue;
            recentCarHits.set(pair, now);
            playHit();
          }
        }

        for (const marker of roadMarkers) {
          marker.mesh.position.z = ((marker.baseZ + myDistance + 210) % 240 + 240) % 240 - 210;
        }
        const routeOffset = ((myDistance % CITY_ROUTE_LOOP) + CITY_ROUTE_LOOP) % CITY_ROUTE_LOOP;
        for (const landmark of routeLandmarks) {
          const relativeDistance = ((landmark.baseDistance - routeOffset + CITY_ROUTE_LOOP) % CITY_ROUTE_LOOP + CITY_ROUTE_LOOP) % CITY_ROUTE_LOOP;
          landmark.object.position.z = 18 - relativeDistance;
          landmark.object.visible = relativeDistance < 150;
        }
        metro.position.z = 18 - routeOffset;
        for (const detail of roadDetails) {
          detail.mesh.position.z = ((detail.baseZ + myDistance + 210) % 240 + 240) % 240 - 210;
        }
        for (const pothole of potholes) {
          pothole.mesh.position.z = ((pothole.baseZ + myDistance + 210) % 240 + 240) % 240 - 210;
        }
        for (const block of roadsideBlocks) {
          const relativeDistance = ((block.baseDistance - myDistance) % blockLoop + blockLoop) % blockLoop;
          block.group.position.z = 18 - relativeDistance;
          block.group.visible = relativeDistance < 150;
        }
        for (const block of skylineBlocks) {
          const relativeDistance = ((block.baseDistance - myDistance) % skylineLoop + skylineLoop) % skylineLoop;
          block.group.position.z = 18 - relativeDistance;
          block.group.visible = relativeDistance < 165;
        }
        const myX = predictedX;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, myX * 0.22, 4, dt);
        const baseFov = camera.aspect < 0.72 ? 72 : 58;
        const targetFov = input.current.boost ? baseFov + 7 : baseFov;
        const nextFov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
        if (Math.abs(nextFov - camera.fov) > 0.01) {
          camera.fov = nextFov;
          camera.updateProjectionMatrix();
        }
        camera.lookAt(myX * 0.12, 1.15, -2);

        if (composer) composer.render();
        else renderer.render(scene, camera);
        if (!firstFrameRendered) {
          firstFrameRendered = true;
          signalReady();
        }
        animationFrame = requestAnimationFrame(render);
      };
      animationFrame = requestAnimationFrame(render);

      const resize = () => {
        if (!renderer) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        const portraitPhone = camera.aspect < 0.72;
        camera.fov = portraitPhone ? 72 : 58;
        camera.position.y = portraitPhone ? 7.4 : 6.4;
        camera.position.z = portraitPhone ? 14.5 : 12;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(devicePixelRatio, mount.clientWidth < 760 ? 1.25 : 1.5));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        composer?.setSize(mount.clientWidth, mount.clientHeight);
      };
      resize();
      window.addEventListener('resize', resize);

      return () => {
        window.removeEventListener('resize', resize);
        window.removeEventListener('jaldi-weather', onWeatherChange as EventListener);
        window.removeEventListener('jaldi-attack-activated', onLocalAttack as EventListener);
        composer?.dispose();
        // Tear down GPU buffers if the scene is rebuilt (player identity
        // change). Without this sweep, procedural meshes and loaded textures
        // would leak their geometry/material buffers.
        scene.traverse(object => {
          const mesh = object as THREE.Mesh | THREE.LineSegments | THREE.InstancedMesh;
          mesh.geometry?.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const material of materials) {
            for (const mapKey of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
              (material as THREE.MeshStandardMaterial)[mapKey]?.dispose();
            }
            material.dispose();
          }
        });
      };
    }

    let removeResize: (() => void) | undefined;
    setup()
      .then(cleanup => { removeResize = cleanup; })
      .catch(error => {
        console.error('GameScene setup failed', error);
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      removeResize?.();
      renderer?.dispose();
      if (renderer?.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [myPlayerId]);

  return <div className="game-canvas" ref={mountRef} aria-label="Live race view" />;
}
