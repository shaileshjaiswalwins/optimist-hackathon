import { useEffect, useRef } from 'react';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

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
      scene.background = new THREE.Color(0x93c9e8);
      scene.fog = new THREE.Fog(0x93c9e8, 55, 135);
      const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 180);
      camera.position.set(0, 7.5, 12);
      camera.lookAt(0, 0, -20);

      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      mount.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x354126, 2.4));
      const sun = new THREE.DirectionalLight(0xfff1c7, 2.8);
      sun.position.set(-8, 18, 10);
      scene.add(sun);

      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 260),
        new THREE.MeshLambertMaterial({ color: 0x343b3e })
      );
      road.rotation.x = -Math.PI / 2;
      road.position.z = -95;
      scene.add(road);

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
        const mesh = createTrafficVehicle(Number(obstacle.obstacleId % 3n));
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

        for (const current of obstaclesRef.current) {
          ensureObstacle(current, 4 - (current.distance - myDistance));
          const key = current.obstacleId.toString();
          const mesh = obstacleMeshes.get(key)!;
          const body = obstacleBodies.get(key)!;
          mesh.visible = current.active;
          const targetX = current.x;
          const targetZ = 4 - (current.distance - myDistance);
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 14, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 12, dt);
          mesh.rotation.y = Math.PI;
          body.setEnabled(current.active);
          if (current.active) body.setNextKinematicTranslation({ x: mesh.position.x, y: 0.9, z: mesh.position.z });
        }

        const roadOffset = myDistance % 10;
        for (const marker of roadMarkers) marker.mesh.position.z = marker.baseZ + roadOffset;
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
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
      };
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
