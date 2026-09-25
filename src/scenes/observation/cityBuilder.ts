import * as THREE from "three/webgpu";
import {
  createBeaconMaterial,
  createBuildingMaterial,
  createGroundMaterial,
  createStreetLampMaterial,
  createTrafficMaterial,
} from "../../rendering/materials/city";
import { createSkyMaterial } from "../../rendering/materials/sky";
import { mulberry32 } from "../../rendering/materials/tslUtils";
import type { QualityProfile } from "../../performance/Quality";

export const GROUND_Y = -230;
export const ROAD_SPACING = 90;
const EXTENT = 2400;

export interface City {
  group: THREE.Group;
  buildings: THREE.InstancedMesh;
  sky: THREE.Mesh;
  traffic: THREE.Sprite;
  lamps: THREE.Sprite;
  /** Tallest nearby building tops, used to place the signal. */
  landmark: THREE.Vector3;
}

/**
 * Procedural city: buildings sit inside road blocks, get taller toward a
 * downtown cluster in front of the facility and stay low near it so the view
 * opens up over the roofs.
 */
export function buildCity(profile: QualityProfile, opts: { seed?: number; facing?: number } = {}): City {
  const group = new THREE.Group();
  group.name = "city";
  const rand = mulberry32(opts.seed ?? 7);

  // --- sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 24), createSkyMaterial(profile.cloudOctaves));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  // --- ground
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT * 2.2, EXTENT * 2.2), createGroundMaterial(ROAD_SPACING));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  group.add(ground);

  // --- buildings
  const count = profile.buildingCount;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const buildings = new THREE.InstancedMesh(unit, createBuildingMaterial(), count);
  buildings.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const downtown = new THREE.Vector2(-260, -1450);
  const tops: THREE.Vector3[] = [];
  let placed = 0;
  let guard = 0;
  const block = ROAD_SPACING;
  const inner = block - 26; // leaves road + sidewalk
  while (placed < count && guard++ < count * 20) {
    // Sample more densely in front of the window (−z hemisphere).
    const ang = (rand() - 0.5) * Math.PI * (rand() < 0.8 ? 1.15 : 2.0) + Math.PI;
    const r = 90 + Math.pow(rand(), 0.75) * (EXTENT - 90);
    const x = Math.sin(ang) * r;
    const z = Math.cos(ang) * r;
    // Snap into a block, random footprint inside it.
    const bx = Math.floor(x / block) * block + block / 2;
    const bz = Math.floor(z / block) * block + block / 2;
    const w = 14 + rand() * (inner - 14) * (rand() < 0.3 ? 1 : 0.6);
    const d = 14 + rand() * (inner - 14) * (rand() < 0.3 ? 1 : 0.6);
    const ox = (rand() - 0.5) * (inner - w);
    const oz = (rand() - 0.5) * (inner - d);
    const cx = bx + ox;
    const cz = bz + oz;
    const dist = Math.hypot(cx, cz);
    if (dist < 110) continue;
    const dd = Math.hypot(cx - downtown.x, cz - downtown.y);
    const core = Math.exp(-(dd * dd) / (2 * 430 * 430));
    const core2 = Math.exp(-Math.pow(Math.hypot(cx - 900, cz + 1700), 2) / (2 * 300 * 300));
    // Mostly mid-rise, a dense tall core in the distance, a second smaller cluster.
    let h = 12 + Math.pow(rand(), 2.6) * 70 + core * (120 + Math.pow(rand(), 0.8) * 330) + core2 * (60 + rand() * 180);
    // Keep the foreground low so the view opens over the roofs.
    const nearCap = THREE.MathUtils.lerp(60, 520, THREE.MathUtils.smoothstep(dist, 180, 1100));
    h = Math.min(h, nearCap * (0.55 + rand() * 0.45));
    p.set(cx, GROUND_Y, cz);
    s.set(w, h, d);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() < 0.08 ? (rand() - 0.5) * 0.4 : 0);
    m.compose(p, q, s);
    buildings.setMatrixAt(placed++, m);
    if (h > 260) tops.push(new THREE.Vector3(cx, GROUND_Y + h, cz));
  }
  buildings.count = placed;
  buildings.instanceMatrix.needsUpdate = true;
  group.add(buildings);

  // --- aviation beacons on the tall ones
  if (tops.length) {
    const beacon = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 8, 6), createBeaconMaterial(), tops.length);
    tops.forEach((t, i) => {
      m.makeTranslation(t.x, t.y + 2, t.z);
      beacon.setMatrixAt(i, m);
    });
    beacon.frustumCulled = false;
    group.add(beacon);
  }

  // --- rooftop clutter (plant rooms, water tanks) on a subset
  {
    const n = Math.min(placed, Math.floor(count * 0.6));
    const roof = new THREE.InstancedMesh(unit, createBuildingMaterial(), n);
    const bm = new THREE.Matrix4();
    const bp = new THREE.Vector3();
    const bs = new THREE.Vector3();
    const bq = new THREE.Quaternion();
    let k = 0;
    for (let i = 0; i < placed && k < n; i++) {
      if (rand() < 0.4) continue;
      buildings.getMatrixAt(i, bm);
      bm.decompose(bp, bq, bs);
      const w = bs.x * (0.2 + rand() * 0.3);
      const d = bs.z * (0.2 + rand() * 0.3);
      const hh = 3 + rand() * 6;
      p.set(bp.x + (rand() - 0.5) * (bs.x - w) * 0.8, bp.y + bs.y, bp.z + (rand() - 0.5) * (bs.z - d) * 0.8);
      m.compose(p, bq, s.set(w, hh, d));
      roof.setMatrixAt(k++, m);
    }
    roof.count = k;
    roof.frustumCulled = false;
    group.add(roof);
  }

  // --- traffic & street lamps (instanced sprites)
  const traffic = new THREE.Sprite(createTrafficMaterial({ roadSpacing: ROAD_SPACING, extent: EXTENT, groundY: GROUND_Y }));
  traffic.count = profile.trafficCount;
  traffic.frustumCulled = false;
  group.add(traffic);

  const lampSpacing = 60;
  const lampExtent = profile.level === "low" ? 1100 : 1600;
  const perRoad = Math.floor((lampExtent * 2) / lampSpacing);
  const roads = Math.floor((lampExtent * 2) / ROAD_SPACING);
  const lamps = new THREE.Sprite(createStreetLampMaterial({ roadSpacing: ROAD_SPACING, extent: lampExtent, groundY: GROUND_Y, spacing: lampSpacing }));
  lamps.count = roads * 2 * perRoad * 2;
  lamps.frustumCulled = false;
  group.add(lamps);

  tops.sort((a, b) => b.y - a.y);
  const landmark = tops[0]?.clone() ?? new THREE.Vector3(-300, 120, -1200);
  return { group, buildings, sky, landmark, traffic, lamps };
}
