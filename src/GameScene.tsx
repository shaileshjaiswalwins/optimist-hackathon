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
  lane: number;
  distance: number;
};

type Obstacle = {
  obstacleId: bigint;
  lane: number;
  distance: number;
  active: boolean;
};

type Props = {
  myPlayerId: bigint;
  profiles: readonly Profile[];
  positions: readonly Position[];
  obstacles: readonly Obstacle[];
};

const LANE_X = [-3.2, 0, 3.2];

function vehicleColor(vehicle: string, isBot: boolean) {
  if (isBot) return 0xe86b47;
  if (vehicle === 'auto') return 0xf6c344;
  if (vehicle === 'scooty') return 0x5dd6c0;
  return 0x79a9ff;
}

export function GameScene({ myPlayerId, profiles, positions, obstacles }: Props) {
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
      for (const x of [-1.6, 1.6]) {
        for (let z = -210; z < 30; z += 10) {
          const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5), stripeMaterial);
          stripe.rotation.x = -Math.PI / 2;
          stripe.position.set(x, 0.012, z);
          scene.add(stripe);
        }
      }

      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const carMeshes = new Map<string, THREE.Mesh>();
      const carBodies = new Map<string, RigidBody>();
      const obstacleMeshes = new Map<string, THREE.Mesh>();
      const obstacleBodies = new Map<string, RigidBody>();

      const ensureCar = (profile: Profile) => {
        const key = profile.playerId.toString();
        if (carMeshes.has(key)) return;
        const group = new THREE.Mesh(
          new THREE.BoxGeometry(profile.vehicleType === 'scooty' ? 1 : 1.7, 1, 3),
          new THREE.MeshLambertMaterial({ color: vehicleColor(profile.vehicleType, profile.isBot) })
        );
        group.position.y = 0.6;
        scene.add(group);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.5, 1.4), body);
        carMeshes.set(key, group);
        carBodies.set(key, body);
      };

      const ensureObstacle = (obstacle: Obstacle) => {
        const key = obstacle.obstacleId.toString();
        if (obstacleMeshes.has(key)) return;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1.7, 1.15, 3.2),
          new THREE.MeshLambertMaterial({ color: 0xd84a38 })
        );
        mesh.position.y = 0.65;
        scene.add(mesh);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.85, 0.55, 1.5), body);
        obstacleMeshes.set(key, mesh);
        obstacleBodies.set(key, body);
      };

      let previous = performance.now();
      const render = (now: number) => {
        if (disposed || !renderer) return;
        const dt = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        const myDistance = positionsRef.current.find(row => row.playerId === myPlayerId)?.distance ?? 0;

        for (const profile of profilesRef.current) ensureCar(profile);
        for (const position of positionsRef.current) {
          const key = position.playerId.toString();
          const mesh = carMeshes.get(key);
          const body = carBodies.get(key);
          if (!mesh || !body) continue;
          const targetX = LANE_X[position.lane + 1] ?? 0;
          const targetZ = position.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 11, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 9, dt);
          mesh.rotation.y = position.playerId === myPlayerId ? 0 : 0;
          body.setNextKinematicTranslation({ x: mesh.position.x, y: 0.6, z: mesh.position.z });
        }

        for (const current of obstaclesRef.current) {
          ensureObstacle(current);
          const key = current.obstacleId.toString();
          const mesh = obstacleMeshes.get(key)!;
          const body = obstacleBodies.get(key)!;
          mesh.visible = current.active;
          const targetX = LANE_X[current.lane + 1] ?? 0;
          const targetZ = 4 - (current.distance - myDistance);
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 14, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 12, dt);
          mesh.rotation.y = Math.PI;
          body.setEnabled(current.active);
          if (current.active) body.setNextKinematicTranslation({ x: mesh.position.x, y: 0.65, z: mesh.position.z });
        }

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
