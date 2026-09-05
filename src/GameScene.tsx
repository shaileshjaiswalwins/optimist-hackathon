import { useEffect, useRef } from 'react';
import type { DynamicRayCastVehicleController, RigidBody } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CITY_ROUTE_LOOP, CITY_ROUTE_ZONES } from './cityLayout';
import { vehicleTuning } from './vehiclePhysics';

const TRAFFIC_ASSETS = [
  '/assets/kenney/car-kit/sedan.glb',
  '/assets/kenney/car-kit/taxi.glb',
  '/assets/kenney/car-kit/delivery.glb',
  '/assets/kenney/car-kit/ambulance.glb',
  '/assets/kenney/car-kit/truck.glb',
  '/assets/kenney/car-kit/police.glb',
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
  quality: 'low' | 'medium' | 'high';
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

function addScootyRider(group: THREE.Group, shirt: number) {
  // A compact low-poly rider makes the scooty read as a vehicle being driven,
  // rather than an empty prop. The silhouette stays clear on mobile.
  group.add(cylinder(0.22, 0.46, 0x7a4e35, 0, 2.12, 0.16, 10));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshLambertMaterial({ color: 0xc98561 }));
  head.position.set(0, 2.48, 0.08);
  group.add(head);
  group.add(box(0.5, 0.62, 0.36, shirt, 0, 1.88, 0.08));
  group.add(box(0.12, 0.62, 0.16, 0x26364a, -0.2, 1.33, 0.36));
  group.add(box(0.12, 0.62, 0.16, 0x26364a, 0.2, 1.33, 0.36));
  const handleArm = box(0.12, 0.52, 0.12, 0xc98561, 0.24, 1.95, -0.34);
  handleArm.rotation.z = -0.72;
  const otherArm = handleArm.clone();
  otherArm.position.x = -0.24;
  otherArm.rotation.z = 0.72;
  group.add(handleArm, otherArm);
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
  addScootyRider(group, color === 0x52d7c2 ? 0xc53f4d : color);
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

function addDistrictDetail(group: THREE.Group, district: number, width: number, depth: number, height: number, side: number) {
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
    // Construction zone: a scaffold and hazard board break up the skyline.
    const scaffoldColor = 0xc88832;
    for (const x of [-width * 0.38, width * 0.38]) {
      group.add(box(0.1, Math.min(height * 0.74, 4.4), 0.1, scaffoldColor, x, 2.2, front - 0.24));
    }
    for (const y of [1.35, 2.55, 3.75]) group.add(box(width * 0.8, 0.1, 0.1, scaffoldColor, 0, y, front - 0.25));
    const sign = streetSign('SLOW', '#e17d27', Math.min(width * 0.5, 2.4));
    sign.position.set(nearSide * width * 0.58, 1.12, front - 0.62);
    group.add(sign);
    group.add(box(1.2, 0.44, 0.1, 0xf2c642, nearSide * width * 0.58, 0.55, front - 0.56));
  } else {
    // Transit zone: a clear bus-stop canopy and bench create a distinct
    // landmark that players can read in one glance.
    const stopX = nearSide * width * 0.58;
    group.add(box(1.8, 0.12, 0.85, 0x2c5e77, stopX, 2.18, front - 0.54));
    group.add(box(0.1, 2.1, 0.1, 0x31586b, stopX - 0.75, 1.08, front - 0.54));
    group.add(box(0.1, 2.1, 0.1, 0x31586b, stopX + 0.75, 1.08, front - 0.54));
    group.add(box(1.28, 0.18, 0.38, 0x714b32, stopX, 0.56, front - 0.54));
    const sign = streetSign('BUS STOP', '#31586b', 1.45);
    sign.position.set(stopX, 1.72, front - 0.99);
    group.add(sign);
  }
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
  const district = Math.floor(index / 5) % 4;

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
  addDistrictDetail(group, district, width, depth, height, side);
  return group;
}

function createBengaluruBackdrop(index: number, side: number) {
  const group = new THREE.Group();
  const width = 5.5 + (index % 3) * 1.2;
  const height = 6.5 + (index % 4) * 1.8;
  const depth = 6 + (index % 2) * 1.6;
  const colors = [0x708d8d, 0xc68655, 0x9b755e, 0x80925e, 0x77759a];
  group.add(box(width, height, depth, colors[index % colors.length], 0, height / 2, 0));
  group.add(box(width + 0.18, 0.18, depth + 0.18, 0x47423c, 0, height + 0.08, 0));
  for (let floor = 1; floor < Math.floor(height / 1.55); floor += 1) {
    group.add(box(width * 0.62, 0.42, 0.05, 0xaed8dd, 0, floor * 1.45 + 0.28, -depth / 2 - 0.03));
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

export function GameScene({ myPlayerId, profiles, positions, obstacles, input, quality, onReady }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const profilesRef = useRef(profiles);
  const positionsRef = useRef(positions);
  const obstaclesRef = useRef(obstacles);
  const onReadyRef = useRef(onReady);

  profilesRef.current = profiles;
  positionsRef.current = positions;
  obstaclesRef.current = obstacles;
  onReadyRef.current = onReady;

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
      const skyColor = new THREE.Color(0xe9a86f);
      scene.background = skyColor;
      scene.fog = new THREE.Fog(0xe9b984, 52, 145);
      const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 180);
      camera.position.set(0, 7.5, 12);
      camera.lookAt(0, 0, -20);

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
      const trafficTemplates = await Promise.all(TRAFFIC_ASSETS.map(async (url, index) => {
        try {
          const asset = await assetLoader.loadAsync(url);
          return normalizeAsset(asset.scene, index === 2 || index === 4 ? 4.8 : 3.8);
        } catch (error) {
          console.warn(`Could not load traffic asset ${url}; using fallback model.`, error);
          return undefined;
        }
      }));
      if (disposed) return;

      const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343b3e, roughness: 0.76, metalness: 0.02 });
      const road = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 260),
        roadMaterial
      );
      road.rotation.x = -Math.PI / 2;
      road.position.z = -95;
      road.receiveShadow = quality !== 'low';
      scene.add(road);

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
        roadMaterial.color.setHex(rainy ? 0x202a30 : 0x343b3e);
        roadMaterial.roughness = rainy ? 0.24 : 0.76;
        roadMaterial.metalness = rainy ? 0.28 : 0.02;
        rain.visible = rainy;
        renderer!.toneMappingExposure = settings.exposure;
      };
      applyEnvironment();

      const shoulderMaterial = new THREE.MeshLambertMaterial({ color: 0x69714d });
      const curbMaterial = new THREE.MeshLambertMaterial({ color: 0xe3d3a5 });
      const sidewalkMaterial = new THREE.MeshLambertMaterial({ color: 0xc8baa1 });
      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 260), shoulderMaterial);
        shoulder.rotation.x = -Math.PI / 2;
        shoulder.position.set(side * 7.6, -0.008, -95);
        scene.add(shoulder);
        const curb = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 260), curbMaterial);
        curb.rotation.x = -Math.PI / 2;
        curb.position.set(side * 6.6, 0.008, -95);
        scene.add(curb);
        // Keep the pavement flat. The previous raised slab exposed a long,
        // strongly lit side face that looked like a glowing/glitching stripe.
        const sidewalk = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 260), sidewalkMaterial);
        sidewalk.rotation.x = -Math.PI / 2;
        sidewalk.position.set(side * 9.2, 0.006, -95);
        scene.add(sidewalk);
      }

      const vergeMaterial = new THREE.MeshLambertMaterial({ color: 0x527b3e });
      for (const side of [-1, 1]) {
        // Start grass after the pavement instead of underneath it, eliminating
        // overlapping ground surfaces at the sidewalk boundary.
        const verge = new THREE.Mesh(new THREE.PlaneGeometry(29.5, 260), vergeMaterial);
        verge.rotation.x = -Math.PI / 2;
        verge.position.set(side * 26.45, -0.02, -95);
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

      const routeLandmarks: Array<{ object: THREE.LOD; baseDistance: number }> = [];
      for (const zone of CITY_ROUTE_ZONES) {
        const landmark = createLandmark(zone.landmark);
        landmark.position.set(zone.id === 'orr' ? -7.6 : zone.id === 'cbd' ? -7.2 : 7.2, 0, 0);
        scene.add(landmark);
        routeLandmarks.push({ object: landmark, baseDistance: zone.start + 34 });
      }
      // Namma Metro’s elevated line is one instanced mesh, not hundreds of
      // separate pillar objects. It runs down the median and loops with the
      // same route-space convention as the roadside prefabs.
      const metro = new THREE.Group();
      const pillarGeometry = new THREE.CylinderGeometry(0.18, 0.22, 4.2, 8);
      const pillarMaterial = new THREE.MeshLambertMaterial({ color: 0x7d8583 });
      const pillars = new THREE.InstancedMesh(pillarGeometry, pillarMaterial, 22);
      const pillarMatrix = new THREE.Matrix4();
      for (let index = 0; index < 22; index += 1) {
        pillarMatrix.makeTranslation(0, 2.1, -index * 28);
        pillars.setMatrixAt(index, pillarMatrix);
      }
      const viaduct = box(1.15, 0.45, 21, 0x626e70, 0, 4.35, -10.5);
      metro.add(pillars, viaduct);
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
          const group = createRoadsideBlock(index + (side > 0 ? 3 : 0), side);
          group.position.x = side * (13.1 + (index % 3) * 0.7);
          group.rotation.y = side > 0 ? -0.035 : 0.035;
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
          const group = createBengaluruBackdrop(index + (side > 0 ? 2 : 0), side);
          group.position.x = side * (18.5 + (index % 2) * 1.5);
          group.rotation.y = side > 0 ? -0.06 : 0.06;
          scene.add(group);
          skylineBlocks.push({ group, baseDistance: index * skylineSpacing + (side > 0 ? skylineSpacing / 2 : 0) });
        }
      }
      // The local chassis is intentionally client-only: SpacetimeDB continues
      // to own scoring, collisions, and all game rules. Rapier gives the
      // player vehicle a stable physical feel between authoritative updates.
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.createCollider(RAPIER.ColliderDesc.cuboid(7, 0.08, 12000).setTranslation(0, -0.08, 0));
      const carMeshes = new Map<string, THREE.Group>();
      const obstacleMeshes = new Map<string, THREE.Group>();
      let localDriveBody: RigidBody | undefined;
      let localVehicle: DynamicRayCastVehicleController | undefined;
      let physicsAccumulator = 0;
      const fixedPhysicsStep = 1 / 60;
      let lastMass = -1;
      let previousPhysicsX = 0;
      let previousPhysicsZ = 0;
      let currentPhysicsX = 0;
      let currentPhysicsZ = 0;
      const correctionImpulse = { x: 0, y: 0, z: 0 };

      const configureWheel = (wheel: number) => {
        const vehicle = localVehicle;
        if (!vehicle) return;
        vehicle.setWheelSuspensionStiffness(wheel, vehicleTuning.suspensionStiffness);
        vehicle.setWheelSuspensionCompression(wheel, vehicleTuning.suspensionCompression);
        vehicle.setWheelSuspensionRelaxation(wheel, vehicleTuning.suspensionRelaxation);
        vehicle.setWheelMaxSuspensionForce(wheel, vehicleTuning.suspensionMaxForce);
        vehicle.setWheelFrictionSlip(wheel, vehicleTuning.tireGrip);
        vehicle.setWheelSideFrictionStiffness(wheel, vehicleTuning.sideFriction);
      };

      const ensureLocalDriveBody = (x: number, distance: number) => {
        if (localDriveBody) return localDriveBody;
        localDriveBody = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, 0.72, -distance)
            .setLinearDamping(0.12)
            .setAngularDamping(1.6)
            .setCanSleep(false)
        );
        // A compact hatchback chassis with its center of mass lifted enough
        // for visible roll and brake dive, while still remaining controllable.
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.62, 0.22, 1.05).setTranslation(0, 0.1, 0), localDriveBody);
        localDriveBody.setAdditionalMass(vehicleTuning.massKg, true);
        lastMass = vehicleTuning.massKg;
        localVehicle = world.createVehicleController(localDriveBody);
        localVehicle.indexUpAxis = 1;
        // Rapier's generated types name this setter incorrectly. The runtime
        // property is still the forward-axis setter and keeps Z as forward.
        localVehicle.setIndexForwardAxis = 2;
        const wheelPoints = [
          { x: -0.53, y: 0.08, z: -0.78 }, { x: 0.53, y: 0.08, z: -0.78 },
          { x: -0.53, y: 0.08, z: 0.78 }, { x: 0.53, y: 0.08, z: 0.78 },
        ];
        for (const point of wheelPoints) {
          localVehicle.addWheel(point, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, vehicleTuning.suspensionRestLength, 0.28);
          configureWheel(localVehicle.numWheels() - 1);
        }
        previousPhysicsX = currentPhysicsX = x;
        previousPhysicsZ = currentPhysicsZ = -distance;
        return localDriveBody;
      };

      const stepLocalVehicle = () => {
        if (!localDriveBody || !localVehicle) return;
        if (lastMass !== vehicleTuning.massKg) {
          localDriveBody.setAdditionalMass(vehicleTuning.massKg, true);
          lastMass = vehicleTuning.massKg;
        }
        const speedKmh = Math.abs(localVehicle.currentVehicleSpeed()) * 3.6;
        const steeringScale = THREE.MathUtils.lerp(1, vehicleTuning.highSpeedSteeringFactor, Math.min(speedKmh / vehicleTuning.topSpeedKmh, 1));
        const steering = input.current.steering * vehicleTuning.maxSteeringAngle * steeringScale;
        const engine = input.current.throttle && speedKmh < vehicleTuning.topSpeedKmh
          ? -vehicleTuning.engineForce * (input.current.boost ? 1.16 : 1)
          : 0;
        const brake = input.current.throttle ? 0 : vehicleTuning.brakeForce * 0.18;
        for (let wheel = 0; wheel < 4; wheel += 1) {
          configureWheel(wheel);
          localVehicle.setWheelSteering(wheel, wheel < 2 ? steering : 0);
          localVehicle.setWheelEngineForce(wheel, wheel >= 2 ? engine : 0);
          localVehicle.setWheelBrake(wheel, brake);
        }
        localVehicle.updateVehicle(fixedPhysicsStep);
        world.timestep = fixedPhysicsStep;
        world.step();
        const translation = localDriveBody.translation();
        previousPhysicsX = currentPhysicsX;
        previousPhysicsZ = currentPhysicsZ;
        currentPhysicsX = translation.x;
        currentPhysicsZ = translation.z;
        if (translation.x < -4.65 || translation.x > 4.65) {
          localDriveBody.setTranslation({ x: THREE.MathUtils.clamp(translation.x, -4.65, 4.65), y: translation.y, z: translation.z }, true);
          localDriveBody.setLinvel({ x: 0, y: 0, z: localDriveBody.linvel().z }, true);
          currentPhysicsX = THREE.MathUtils.clamp(currentPhysicsX, -4.65, 4.65);
        }
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
        if (obstacleMeshes.has(key)) return;
        const variant = Number(obstacle.obstacleId % BigInt(trafficTemplates.length));
        const mesh = trafficTemplates[variant]?.clone(true) ?? createTrafficVehicle(variant % 3);
        if (quality !== 'low') mesh.traverse(child => {
          if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        mesh.position.set(obstacle.x, 0, initialZ);
        scene.add(mesh);
        obstacleMeshes.set(key, mesh);
      };

      let previous = performance.now();
      let predictedX: number | undefined;
      let predictedDistance: number | undefined;
      let firstFrameRendered = false;
      const render = (now: number) => {
        if (disposed || !renderer) return;
        const dt = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        const authoritativeMe = positionsRef.current.find(row => row.playerId === myPlayerId);
        if (authoritativeMe) {
          const body = ensureLocalDriveBody(authoritativeMe.x, authoritativeMe.distance);
          const translation = body.translation();
          const serverZ = -authoritativeMe.distance;
          // Keep the local simulation responsive but gently pull it toward
          // SpacetimeDB's authoritative result. A large error means a new
          // round/reconnect and is safely reset in one step.
          if (Math.abs(translation.x - authoritativeMe.x) > 5 || Math.abs(translation.z - serverZ) > 12) {
            body.setTranslation({ x: authoritativeMe.x, y: 0.72, z: serverZ }, true);
            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            previousPhysicsX = currentPhysicsX = authoritativeMe.x;
            previousPhysicsZ = currentPhysicsZ = serverZ;
          } else {
            correctionImpulse.x = (authoritativeMe.x - translation.x) * 0.045;
            correctionImpulse.y = 0;
            correctionImpulse.z = (serverZ - translation.z) * 0.045;
            body.applyImpulse(correctionImpulse, true);
          }
        }
        physicsAccumulator += dt;
        while (physicsAccumulator >= fixedPhysicsStep) {
          stepLocalVehicle();
          physicsAccumulator -= fixedPhysicsStep;
        }
        if (localDriveBody) {
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

        const positionsByPlayer = new Map(positionsRef.current.map(position => [position.playerId, position]));
        for (const profile of profilesRef.current) {
          const position = positionsByPlayer.get(profile.playerId);
          if (!position) continue;
          const initialX = profile.playerId === myPlayerId ? predictedX : position.x;
          const initialZ = profile.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          ensureCar(profile, initialX, initialZ);
        }
        for (const position of positionsRef.current) {
          const key = position.playerId.toString();
          const mesh = carMeshes.get(key);
          if (!mesh) continue;
          const targetX = position.playerId === myPlayerId ? predictedX : position.x;
          const targetZ = position.playerId === myPlayerId ? 4 : 4 - (position.distance - myDistance);
          mesh.position.x = THREE.MathUtils.damp(mesh.position.x, targetX, 11, dt);
          mesh.position.z = THREE.MathUtils.damp(mesh.position.z, targetZ, 9, dt);
          const visualSteering = position.playerId === myPlayerId ? input.current.steering : position.steering;
          mesh.rotation.y = THREE.MathUtils.damp(mesh.rotation.y, -visualSteering * 0.13, 10, dt);
          mesh.rotation.z = THREE.MathUtils.damp(mesh.rotation.z, -visualSteering * 0.07, 10, dt);
        }

        // Obstacle rows are the source of truth. Retire their meshes when the
        // server removes the row, rather than leaving stale traffic frozen on
        // the road. This also bounds the number of Three.js objects in a
        // long-running match.
        const liveObstacleKeys = new Set(obstaclesRef.current.map(row => row.obstacleId.toString()));
        for (const [key, mesh] of obstacleMeshes) {
          if (liveObstacleKeys.has(key)) continue;
          scene.remove(mesh);
          obstacleMeshes.delete(key);
        }

        for (const current of obstaclesRef.current) {
          ensureObstacle(current, 4 - (current.distance - myDistance));
          const key = current.obstacleId.toString();
          const mesh = obstacleMeshes.get(key)!;
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
        camera.lookAt(myX * 0.12, 0.5, -20);

        if (composer) composer.render();
        else renderer.render(scene, camera);
        if (!firstFrameRendered) {
          firstFrameRendered = true;
          onReadyRef.current();
        }
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
        composer?.setSize(mount.clientWidth, mount.clientHeight);
      };
      resize();
      window.addEventListener('resize', resize);

      return () => {
        window.removeEventListener('resize', resize);
        window.removeEventListener('jaldi-weather', onWeatherChange as EventListener);
        composer?.dispose();
        rainGeometry.dispose();
        localVehicle?.free();
        world.free();
      };
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
  }, [myPlayerId, quality]);

  return <div className="game-canvas" ref={mountRef} aria-label="Live race view" />;
}
