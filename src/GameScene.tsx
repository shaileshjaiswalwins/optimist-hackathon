import { useEffect, useRef } from 'react';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TRAFFIC_ASSETS = [
  '/assets/kenney/car-kit/sedan.glb',
  '/assets/kenney/car-kit/taxi.glb',
  '/assets/kenney/car-kit/delivery.glb',
  '/assets/kenney/car-kit/ambulance.glb',
  '/assets/kenney/car-kit/truck.glb',
  '/assets/kenney/car-kit/police.glb',
];

const ROADSIDE_ASSETS = [
  { url: '/assets/kenney/city-kit-roads/light-curved.glb', height: 5.8 },
  { url: '/assets/kenney/city-kit-roads/traffic-light.glb', height: 4.6 },
  { url: '/assets/kenney/city-kit-roads/road-sign-warning.glb', height: 2.4 },
  { url: '/assets/kenney/city-kit-roads/construction-barrier.glb', height: 0.85 },
];

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
  steering: number;
};

type Obstacle = {
  obstacleId: bigint;
  x: number;
  distance: number;
  active: boolean;
};

type Props = {
  myPlayerId: bigint;
  profiles: readonly Profile[];
  positions: readonly Position[];
  obstacles: readonly Obstacle[];
  input: { current: { steering: number; throttle: number; boost: boolean } };
};

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

function wheel(x: number, z: number, radius = 0.35) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.25, 12),
    new THREE.MeshLambertMaterial({ color: 0x151515 })
  );
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, radius, z);
  return mesh;
}

function addFourWheels(group: THREE.Group, width: number, front: number, rear: number, radius = 0.35) {
  for (const x of [-width, width]) {
    group.add(wheel(x, front, radius), wheel(x, rear, radius));
  }
}

function createAuto(color: number) {
  const group = new THREE.Group();
  group.add(box(1.55, 0.65, 2.2, 0x16814c, 0, 0.65, 0.2));
  group.add(box(1.48, 1.15, 1.45, color, 0, 1.45, 0.28));
  group.add(box(1.62, 0.16, 1.7, 0x181818, 0, 2.08, 0.28));
  group.add(box(1.25, 0.7, 0.06, 0x9ed9e9, 0, 1.55, -0.48));
  group.add(box(1.3, 0.18, 0.15, 0xf4d34f, 0, 0.93, -1));
  group.add(wheel(-0.72, 0.82, 0.32), wheel(0.72, 0.82, 0.32), wheel(0, -0.85, 0.34));
  return group;
}

function createScooty(color: number) {
  const group = new THREE.Group();
  const rear = wheel(0, 0.72, 0.42);
  const front = wheel(0, -0.92, 0.42);
  rear.rotation.z = 0;
  front.rotation.z = 0;
  group.add(rear, front);
  group.add(box(0.55, 0.55, 1.3, color, 0, 0.72, 0));
  group.add(box(0.62, 0.18, 0.75, 0x272727, 0, 1.15, 0.25));
  group.add(box(0.14, 1.15, 0.14, 0xb8c2c4, 0, 1.2, -0.7));
  group.add(box(0.9, 0.1, 0.1, 0x252525, 0, 1.75, -0.7));
  group.add(box(0.38, 0.28, 0.25, 0xf2e092, 0, 1.44, -0.82));
  return group;
}

function createThar(color: number) {
  const group = new THREE.Group();
  group.add(box(1.95, 0.75, 3.25, color, 0, 0.85, 0));
  group.add(box(1.82, 1.05, 1.85, color, 0, 1.7, 0.35));
  group.add(box(1.52, 0.58, 0.07, 0x8dc7db, 0, 1.82, -0.62));
  group.add(box(1.96, 0.12, 1.95, 0x202629, 0, 2.28, 0.35));
  group.add(box(1.5, 0.16, 0.12, 0x202020, 0, 0.86, -1.68));
  group.add(box(0.18, 0.18, 0.1, 0xffefaa, -0.62, 1.08, -1.66));
  group.add(box(0.18, 0.18, 0.1, 0xffefaa, 0.62, 1.08, -1.66));
  addFourWheels(group, 0.94, -1.05, 1.05, 0.43);
  return group;
}

function createPlayerVehicle(profile: Profile) {
  const accent = profile.isBot ? 0xf06445 : profile.vehicleType === 'auto' ? 0xf6c344 : profile.vehicleType === 'scooty' ? 0x52d7c2 : 0x5f91e8;
  if (profile.vehicleType === 'auto') return createAuto(accent);
  if (profile.vehicleType === 'scooty') return createScooty(accent);
  return createThar(accent);
}

function createTrafficVehicle(variant: number) {
  const group = new THREE.Group();
  if (variant === 0) {
    group.add(box(1.8, 0.7, 3.3, 0xdb4c3d, 0, 0.78, 0));
    group.add(box(1.65, 0.65, 1.7, 0xf4a15f, 0, 1.42, 0.25));
    group.add(box(1.35, 0.35, 0.06, 0x98d2e4, 0, 1.55, -0.62));
    addFourWheels(group, 0.86, -1.05, 1.05);
  } else if (variant === 1) {
    group.add(box(2.05, 1.5, 4.7, 0x3482a2, 0, 1.2, 0));
    group.add(box(1.72, 0.62, 0.06, 0xbde3ed, 0, 1.55, -2.37));
    group.add(box(1.65, 0.18, 0.08, 0xffdd62, 0, 0.72, -2.39));
    addFourWheels(group, 0.98, -1.55, 1.55, 0.42);
  } else {
    group.add(box(1.95, 0.8, 2.2, 0xf0a33a, 0, 0.9, -1.05));
    group.add(box(1.85, 1.2, 1.25, 0xe36d34, 0, 1.45, -1.2));
    group.add(box(2.05, 1.2, 2.65, 0x65736f, 0, 1.35, 1.25));
    group.add(box(1.55, 0.45, 0.06, 0xa8dbe7, 0, 1.58, -1.85));
    addFourWheels(group, 0.96, -1.45, 1.6, 0.43);
  }
  return group;
}

function normalizeAsset(source: THREE.Group, targetSize: number, byHeight = false) {
  const container = new THREE.Group();
  const model = source.clone(true);
  container.add(model);
  model.updateMatrixWorld(true);
  const initialBounds = new THREE.Box3().setFromObject(model);
  const size = initialBounds.getSize(new THREE.Vector3());
  const referenceSize = byHeight ? size.y : Math.max(size.x, size.z);
  model.scale.setScalar(referenceSize > 0 ? targetSize / referenceSize : 1);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;
  return container;
}

function createRoadsideBlock(index: number, side: number) {
  const group = new THREE.Group();
  const palettes = [0xe6a15c, 0x75a6a4, 0xd87668, 0xd1b36a, 0x8c83a8, 0xb9c477];
  const awningPalettes = [0xc84636, 0x197c78, 0xe4a12f, 0x4d6094, 0x8c3940];
  const width = 4.2 + (index % 3) * 0.8;
  const depth = 4.5 + ((index + 1) % 3) * 0.9;
  const floors = 2 + (index % 4);
  const height = floors * 1.65;
  const color = palettes[index % palettes.length];
  const awningColor = awningPalettes[index % awningPalettes.length];

  // Footpath and a painted curb make the road feel like a real neighborhood
  // rather than buildings placed directly on grass.
  group.add(box(width + 1.35, 0.18, depth + 1.1, 0xbcae91, 0, 0.06, 0.25));
  group.add(box(width + 1.5, 0.16, 0.24, index % 2 ? 0xf1ca54 : 0xf1eee0, 0, 0.12, -depth / 2 - 0.3));
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

  // Balconies, rooftop tanks and small satellite dishes give each repeated
  // building a recognisable silhouette at road speed.
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

  // A simple tree and lamp make each block read as a lively Indian roadside.
  const treeX = side > 0 ? -width * 0.72 : width * 0.72;
  group.add(box(0.22, 1.8, 0.22, 0x68452f, treeX, 0.9, -depth / 2 - 0.8));
  const crown = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.85, 0),
    new THREE.MeshLambertMaterial({ color: 0x3d773e })
  );
  crown.position.set(treeX, 2.15, -depth / 2 - 0.8);
  group.add(crown);
  group.add(box(0.1, 2.8, 0.1, 0x343b3e, -treeX, 1.4, -depth / 2 - 0.6));
  group.add(box(0.55, 0.14, 0.22, 0xffe7a3, -treeX + side * 0.22, 2.75, -depth / 2 - 0.6));
  if (index % 3 === 0) {
    // A tiny chai/kirana stall silhouette adds local character without a
    // heavy texture or another downloaded asset.
    const stallX = side > 0 ? width * 0.55 : -width * 0.55;
    group.add(box(1.05, 0.82, 0.72, 0x7f5132, stallX, 0.5, -depth / 2 - 0.62));
    group.add(box(1.22, 0.13, 0.9, 0xe2b84d, stallX, 0.98, -depth / 2 - 0.62));
    group.add(cylinder(0.12, 0.22, 0xd9d4bd, stallX - 0.25, 1.16, -depth / 2 - 0.75, 8));
  }
  return group;
}

export function GameScene({ myPlayerId, profiles, positions, obstacles, input }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const profilesRef = useRef(profiles);
  const positionsRef = useRef(positions);
  const obstaclesRef = useRef(obstacles);

  profilesRef.current = profiles;
  positionsRef.current = positions;
  obstaclesRef.current = obstacles;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let animationFrame = 0;

    async function setup() {
      const { default: RAPIER } = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      if (disposed || !mount) return;

      const scene = new THREE.Scene();
      // Golden-hour colour grading provides a warmer, more memorable city
      // without an expensive sky shader (important for event phones).
      scene.background = new THREE.Color(0xe9a86f);
      scene.fog = new THREE.Fog(0xe9b984, 52, 145);
      const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 180);
      camera.position.set(0, 7.5, 12);
      camera.lookAt(0, 0, -20);

      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, mount.clientWidth < 760 ? 1.25 : 1.5));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffd8b0, 0x3d5b35, 2.7));
      const sun = new THREE.DirectionalLight(0xffc26e, 3.3);
      sun.position.set(-8, 18, 10);
      scene.add(sun);
      const sunDisk = new THREE.Mesh(
        new THREE.CircleGeometry(8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false })
      );
      sunDisk.position.set(-27, 23, -125);
      sunDisk.lookAt(camera.position);
      scene.add(sunDisk);

      const assetLoader = new GLTFLoader();
      const trafficTemplates = await Promise.all(TRAFFIC_ASSETS.map(async (url, index) => {
        try {
          const asset = await assetLoader.loadAsync(url);
          return normalizeAsset(asset.scene, index === 2 || index === 4 ? 4.8 : 3.8);
        } catch (error) {
          console.warn(`Could not load traffic asset ${url}; using fallback model.`, error);
          return undefined;
        }
      }));
      const roadsideTemplates = await Promise.all(ROADSIDE_ASSETS.map(async ({ url, height }) => {
        try {
          const asset = await assetLoader.loadAsync(url);
          return normalizeAsset(asset.scene, height, true);
        } catch (error) {
          console.warn(`Could not load roadside asset ${url}.`, error);
          return undefined;
        }
      }));
      if (disposed) return;

      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 260),
        new THREE.MeshLambertMaterial({ color: 0x343b3e })
      );
      road.rotation.x = -Math.PI / 2;
      road.position.z = -95;
      scene.add(road);

      const shoulderMaterial = new THREE.MeshLambertMaterial({ color: 0x69714d });
      const curbMaterial = new THREE.MeshLambertMaterial({ color: 0xe3d3a5 });
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 260), shoulderMaterial);
        shoulder.rotation.x = -Math.PI / 2;
        shoulder.position.set(side * 7.6, -0.008, -95);
        scene.add(shoulder);
        const curb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 260), curbMaterial);
        curb.position.set(side * 6.6, 0.08, -95);
        scene.add(curb);
      }

      const vergeMaterial = new THREE.MeshLambertMaterial({ color: 0x527b3e });
      for (const side of [-1, 1]) {
        const verge = new THREE.Mesh(new THREE.PlaneGeometry(35, 260), vergeMaterial);
        verge.rotation.x = -Math.PI / 2;
        verge.position.set(side * 23.8, -0.02, -95);
        scene.add(verge);
      }
      const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf3e8bd });
      const roadMarkers: Array<{ mesh: THREE.Mesh; baseZ: number }> = [];
      for (const x of [-1.6, 1.6]) {
        for (let z = -210; z < 30; z += 10) {
          const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5), stripeMaterial);
          stripe.rotation.x = -Math.PI / 2;
          stripe.position.set(x, 0.012, z);
          scene.add(stripe);
          roadMarkers.push({ mesh: stripe, baseZ: z });
        }
      }
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
          const group = createRoadsideBlock(index + (side > 0 ? 3 : 0), side);
          group.position.x = side * (10.3 + (index % 3) * 0.7);
          group.rotation.y = side > 0 ? -0.035 : 0.035;
          scene.add(group);
          roadsideBlocks.push({ group, baseDistance: index * blockSpacing + (side > 0 ? blockSpacing / 2 : 0) });
        }
      }
      const roadsideProps: Array<{ group: THREE.Group; baseDistance: number }> = [];
      const propSpacing = 22;
      const propLoop = 18 * propSpacing;
      for (const side of [-1, 1]) {
        for (let index = 0; index < 18; index += 1) {
          const template = roadsideTemplates[index % roadsideTemplates.length];
          if (!template) continue;
          const group = template.clone(true);
          group.position.x = side * 7.25;
          group.rotation.y = side > 0 ? Math.PI : 0;
          scene.add(group);
          roadsideProps.push({
            group,
            baseDistance: index * propSpacing + (side > 0 ? propSpacing / 2 : 0),
          });
        }
      }

      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const carMeshes = new Map<string, THREE.Group>();
      const carBodies = new Map<string, RigidBody>();
      const obstacleMeshes = new Map<string, THREE.Group>();
      const obstacleBodies = new Map<string, RigidBody>();

      const ensureCar = (profile: Profile, initialX: number, initialZ: number) => {
        const key = profile.playerId.toString();
        if (carMeshes.has(key)) return;
        const group = createPlayerVehicle(profile);
        group.position.set(initialX, 0, initialZ);
        scene.add(group);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.5, 1.4), body);
        carMeshes.set(key, group);
        carBodies.set(key, body);
      };

      const ensureObstacle = (obstacle: Obstacle, initialZ: number) => {
        const key = obstacle.obstacleId.toString();
        if (obstacleMeshes.has(key)) return;
        const variant = Number(obstacle.obstacleId % BigInt(trafficTemplates.length));
        const mesh = trafficTemplates[variant]?.clone(true) ?? createTrafficVehicle(variant % 3);
        mesh.position.set(obstacle.x, 0, initialZ);
        scene.add(mesh);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 0.55, 1.5), body);
        obstacleMeshes.set(key, mesh);
        obstacleBodies.set(key, body);
      };

      let previous = performance.now();
      let predictedX: number | undefined;
      let predictedDistance: number | undefined;
      let predictedSpeed = 0;
      const render = (now: number) => {
        if (disposed || !renderer) return;
        const dt = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        const authoritativeMe = positionsRef.current.find(row => row.playerId === myPlayerId);
        if (predictedX === undefined) predictedX = authoritativeMe?.x ?? 0;
        if (predictedDistance === undefined) predictedDistance = authoritativeMe?.distance ?? 0;
        const targetSpeed = input.current.throttle * 24 + (input.current.boost ? 7 : 0);
        predictedSpeed = THREE.MathUtils.damp(predictedSpeed, targetSpeed, 7, dt);
        predictedX = Math.max(-4.65, Math.min(4.65, predictedX + input.current.steering * (3.2 + predictedSpeed * 0.12) * dt));
        predictedDistance += predictedSpeed * dt;
        if (authoritativeMe) {
          predictedX = THREE.MathUtils.damp(predictedX, authoritativeMe.x, 3.2, dt);
          predictedDistance = THREE.MathUtils.damp(predictedDistance, authoritativeMe.distance, 2.2, dt);
        }
        const myDistance = predictedDistance;

        for (const profile of profilesRef.current) {
          const position = positionsRef.current.find(row => row.playerId === profile.playerId);
          if (!position) continue;
          const initialX = profile.playerId === myPlayerId ? predictedX : position.x;
          const initialZ = profile.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          ensureCar(profile, initialX, initialZ);
        }
        for (const position of positionsRef.current) {
          const key = position.playerId.toString();
          const mesh = carMeshes.get(key);
          const body = carBodies.get(key);
          if (!mesh || !body) continue;
          const targetX = position.playerId === myPlayerId ? predictedX : position.x;
          const targetZ = position.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 11, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 9, dt);
          const visualSteering = position.playerId === myPlayerId ? input.current.steering : position.steering;
          mesh.rotation.y = THREE.MathUtils.damp(mesh.rotation.y, -visualSteering * 0.13, 10, dt);
          mesh.rotation.z = THREE.MathUtils.damp(mesh.rotation.z, -visualSteering * 0.07, 10, dt);
          body.setNextKinematicTranslation({ x: mesh.position.x, y: 0.8, z: mesh.position.z });
        }

        // Obstacle rows are the source of truth. Retire their meshes when the
        // server removes the row, rather than leaving stale traffic frozen on
        // the road. This also bounds the number of Three/Rapier objects in a
        // long-running match.
        const liveObstacleKeys = new Set(obstaclesRef.current.map(row => row.obstacleId.toString()));
        for (const [key, mesh] of obstacleMeshes) {
          if (liveObstacleKeys.has(key)) continue;
          scene.remove(mesh);
          const body = obstacleBodies.get(key);
          if (body) world.removeRigidBody(body);
          obstacleMeshes.delete(key);
          obstacleBodies.delete(key);
        }

        for (const current of obstaclesRef.current) {
          ensureObstacle(current, 4 - (current.distance - myDistance));
          const key = current.obstacleId.toString();
          const mesh = obstacleMeshes.get(key)!;
          const body = obstacleBodies.get(key)!;
          const targetX = current.x;
          const targetZ = 4 - (current.distance - myDistance);
          // Do not hide an approaching vehicle based on a locally predicted
          // overlap. That prediction includes other racers and was making
          // traffic disappear before the server had actually resolved a hit.
          const visuallyActive = current.active;
          mesh.visible = visuallyActive;
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 14, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 12, dt);
          mesh.rotation.y = Math.PI;
          body.setEnabled(visuallyActive);
          if (visuallyActive) body.setNextKinematicTranslation({ x: mesh.position.x, y: 0.9, z: mesh.position.z });
        }

        for (const marker of roadMarkers) {
          marker.mesh.position.z = ((marker.baseZ + myDistance + 210) % 240 + 240) % 240 - 210;
        }
        for (const detail of roadDetails) {
          detail.mesh.position.z = ((detail.baseZ + myDistance + 210) % 240 + 240) % 240 - 210;
        }
        for (const block of roadsideBlocks) {
          const relativeDistance = ((block.baseDistance - myDistance) % blockLoop + blockLoop) % blockLoop;
          block.group.position.z = 18 - relativeDistance;
          block.group.visible = relativeDistance < 150;
        }
        for (const prop of roadsideProps) {
          const relativeDistance = ((prop.baseDistance - myDistance) % propLoop + propLoop) % propLoop;
          prop.group.position.z = 18 - relativeDistance;
          prop.group.visible = relativeDistance < 150;
        }
        const myX = predictedX;
        camera.position.x = THREE.MathUtils.damp(camera.position.x, myX * 0.22, 4, dt);
        camera.lookAt(myX * 0.12, 0.5, -20);

        world.step();
        renderer.render(scene, camera);
        animationFrame = requestAnimationFrame(render);
      };
      animationFrame = requestAnimationFrame(render);

      const resize = () => {
        if (!renderer) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        const portraitPhone = camera.aspect < 0.72;
        camera.fov = portraitPhone ? 72 : 58;
        camera.position.y = portraitPhone ? 8.7 : 7.5;
        camera.position.z = portraitPhone ? 15 : 12;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(devicePixelRatio, mount.clientWidth < 760 ? 1.25 : 1.5));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
      resize();
      window.addEventListener('resize', resize);

      return () => window.removeEventListener('resize', resize);
    }

    let removeResize: (() => void) | undefined;
    setup().then(cleanup => { removeResize = cleanup; });
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
