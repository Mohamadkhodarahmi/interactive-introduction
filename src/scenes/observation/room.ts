import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  fract,
  hash,
  instanceIndex,
  mix,
  mrt,
  positionWorld,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec3,
  vec4,
  mx_noise_float,
} from "three/tsl";
import { Batch, cableGeometry, floorCableGeometry } from "../../rendering/geo";
import {
  createFloorMaterial,
  createGlassMaterial,
  createLedgeMaterial,
  createMetalMaterial,
  createPaintedMaterial,
} from "../../rendering/materials/surfaces";
import { Screen } from "../../rendering/Screen";
import { asV3, type N } from "../../rendering/materials/tslUtils";
import type { QualityProfile } from "../../performance/Quality";

export const ROOM = {
  x0: -6,
  x1: 6,
  z1: 4,
  height: 3.6,
  /** Glass wall: z at floor and at ceiling (leans outward). */
  zGlassBottom: -4.6,
  zGlassTop: -5.6,
  sill: 0.47,
  header: 3.4,
};
export const glassZ = (y: number): number => ROOM.zGlassBottom + ((ROOM.zGlassTop - ROOM.zGlassBottom) * y) / ROOM.height;

export const LEAK = new THREE.Vector3(-4.2, 0, -3.75);
export const DOOR = { x: 6, z: 0.3, w: 1.3, h: 2.35 };

/** Uniforms the story drives. */
export const roomUniforms = {
  /** Main power 0..1 (with flicker applied by the scene). */
  power: uniform(0),
  /** Ceiling fixtures brightness 0..1 (flickers independently during boot). */
  ceiling: uniform(0),
  ceilingColor: uniform(new THREE.Color(1.0, 0.88, 0.74)),
  /** Standby amber indicator (visible in the dark). */
  standby: uniform(1),
  /** Rack LEDs activity. */
  racks: uniform(0),
  /** Warm spill from the hidden room. */
  doorGlow: uniform(0),
};

export interface Room {
  group: THREE.Group;
  floor: THREE.Mesh;
  glass: THREE.Mesh[];
  consoleScreens: { center: Screen; left: Screen; right: Screen };
  screenMeshes: THREE.Mesh[];
  doorScreen: Screen;
  doorLeaf: THREE.Mesh;
  doorPanel: THREE.Object3D;
  breaker: { body: THREE.Object3D; cover: THREE.Object3D; lever: THREE.Object3D; anchor: THREE.Vector3 };
  racks: THREE.Object3D[];
  drip: THREE.Mesh;
  chair: THREE.Object3D;
  lights: {
    city: THREE.DirectionalLight;
    ambient: THREE.HemisphereLight;
    emergency: THREE.PointLight;
    ceiling: THREE.SpotLight[];
    console: THREE.PointLight;
    door: THREE.PointLight;
    doorWash: THREE.SpotLight;
    flash: THREE.DirectionalLight;
  };
  emergencyLamp: THREE.Mesh;
  ledgeY: number;
}

function signTexture(lines: { text: string; size: number; color?: string; weight?: number }[], w = 512, h = 128, bg = "rgba(0,0,0,0)"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  let y = 0;
  const total = lines.reduce((a, l) => a + l.size * 1.3, 0);
  y = (h - total) / 2;
  for (const l of lines) {
    ctx.font = `${l.weight ?? 600} ${l.size}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.fillStyle = l.color ?? "#c9ced3";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(l.size * 0.18)}px`;
    ctx.fillText(l.text, 8, y);
    y += l.size * 1.3;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function decal(tex: THREE.Texture, w: number, h: number, opacity = 0.8): THREE.Mesh {
  const m = new THREE.MeshStandardNodeMaterial({ map: tex, transparent: true, opacity, roughness: 0.8, metalness: 0, depthWrite: false });
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoom(profile: QualityProfile, env: THREE.Texture | null, reflection: ((uv: N) => N) | null): Room {
  const group = new THREE.Group();
  group.name = "room";
  const R = ROOM;
  const b = new Batch();

  // ---------------------------------------------------------------- materials
  const wallMat = createPaintedMaterial(0x2a2e33, 0.78, 0.1, 0.3);
  const wallDark = createPaintedMaterial(0x1a1d21, 0.7, 0.2, 0.25);
  const ceilingMat = createPaintedMaterial(0x16181b, 0.9, 0.05, 0.2);
  const steel = createMetalMaterial(0x6d737a, 0.38);
  const darkSteel = createMetalMaterial(0x2a2d31, 0.45);
  const blackened = createPaintedMaterial(0x0c0d0f, 0.55, 0.3, 0.1);
  const rubber = new THREE.MeshStandardNodeMaterial({ color: 0x08090a, roughness: 0.75, metalness: 0 });
  const deskTop = createPaintedMaterial(0x232629, 0.45, 0.05, 0.12);
  const hazard = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  hazard.colorNode = Fn(() => {
    const s = step(0.5, fract(positionWorld.x.add(positionWorld.y).add(positionWorld.z).mul(6)));
    const worn = mx_noise_float(positionWorld.mul(14)).mul(0.5).add(0.5);
    return mix(vec3(0.012, 0.012, 0.012), vec3(0.55, 0.36, 0.03).mul(worn.mul(0.35).add(0.65)), s);
  })();

  // ---------------------------------------------------------------- floor
  const floorMat = createFloorMaterial(LEAK, reflection);
  const floor_ = new THREE.Mesh(new THREE.PlaneGeometry(12, 8.9, 1, 1), floorMat);
  floor_.rotation.x = -Math.PI / 2;
  floor_.position.set(0, 0, -0.45);
  floor_.receiveShadow = true;
  group.add(floor_);

  // ---------------------------------------------------------------- ceiling
  const ceilGeo = new THREE.PlaneGeometry(12, R.z1 - R.zGlassTop);
  ceilGeo.rotateX(Math.PI / 2);
  b.add(ceilGeo, ceilingMat, [0, R.height, (R.z1 + R.zGlassTop) / 2]);
  for (const z of [-4.2, -2.1, 0, 2.1]) b.box(12, 0.24, 0.32, wallDark, [0, R.height - 0.12, z]);
  for (const x of [-4, 0, 4]) b.box(0.18, 0.1, R.z1 - R.zGlassTop, wallDark, [x, R.height - 0.05, (R.z1 + R.zGlassTop) / 2]);

  // Light fixtures: housing + diffuser (emissive, power-driven).
  const fixtureMat = new THREE.MeshBasicNodeMaterial();
  const fixtureCol = Fn(() => {
    const across = smoothstep(float(0.0), float(0.25), uv().y).mul(smoothstep(float(1.0), float(0.75), uv().y));
    return asV3(roomUniforms.ceilingColor).mul(roomUniforms.ceiling.mul(9).mul(across.mul(0.4).add(0.6))).add(vec3(0.015, 0.016, 0.018));
  })();
  fixtureMat.colorNode = fixtureCol;
  fixtureMat.mrtNode = mrt({ emissive: vec4(fixtureCol.mul(0.25), 1) });
  const fixturePositions: [number, number][] = [
    [-2.2, -3.15],
    [2.2, -3.15],
    [-2.2, -1.05],
    [2.2, -1.05],
    [-2.2, 1.05],
    [2.2, 1.05],
    [0, 3.0],
  ];
  const fixtures = new THREE.Group();
  for (const [x, z] of fixturePositions) {
    b.box(1.9, 0.08, 0.36, darkSteel, [x, R.height - 0.28, z]);
    const diff = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.26), fixtureMat);
    diff.rotation.x = Math.PI / 2;
    diff.position.set(x, R.height - 0.321, z);
    fixtures.add(diff);
    // hangers
    b.cyl(0.006, 0.006, 0.2, steel, [x - 0.8, R.height - 0.14, z], [0, 0, 0], 4);
    b.cyl(0.006, 0.006, 0.2, steel, [x + 0.8, R.height - 0.14, z], [0, 0, 0], 4);
  }
  group.add(fixtures);

  // ---------------------------------------------------------------- walls
  // Side walls are trapezoids (they meet the leaning glass).
  const sideShape = (hole?: { z0: number; z1: number; h: number }) => {
    const s = new THREE.Shape();
    s.moveTo(R.z1, 0);
    s.lineTo(R.zGlassBottom, 0);
    s.lineTo(R.zGlassTop, R.height);
    s.lineTo(R.z1, R.height);
    s.closePath();
    if (hole) {
      const hpath = new THREE.Path();
      hpath.moveTo(hole.z0, 0.001);
      hpath.lineTo(hole.z1, 0.001);
      hpath.lineTo(hole.z1, hole.h);
      hpath.lineTo(hole.z0, hole.h);
      hpath.closePath();
      s.holes.push(hpath);
    }
    return s;
  };
  {
    const g = new THREE.ShapeGeometry(sideShape());
    // shape is in (x=z, y=y); map to wall at x0 facing +x
    g.rotateY(Math.PI / 2);
    g.scale(1, 1, -1);
    b.add(g, wallMat, [R.x0, 0, 0]);
  }
  {
    const g = new THREE.ShapeGeometry(sideShape({ z0: DOOR.z - DOOR.w / 2, z1: DOOR.z + DOOR.w / 2, h: DOOR.h }));
    g.rotateY(-Math.PI / 2);
    b.add(g, wallMat, [R.x1, 0, 0]);
  }
  // Back wall
  {
    const g = new THREE.PlaneGeometry(12, R.height);
    g.rotateY(Math.PI);
    b.add(g, wallMat, [0, R.height / 2, R.z1]);
  }
  // Vertical panel ribs + skirting on all walls.
  for (let z = -4.2; z < R.z1; z += 1.2) {
    for (const x of [R.x0 + 0.02, R.x1 - 0.02]) {
      if (x > 0 && Math.abs(z - DOOR.z) < DOOR.w / 2 + 0.1) continue;
      b.box(0.04, R.height, 0.05, wallDark, [x, R.height / 2, z]);
    }
  }
  for (let x = -4.8; x < 6; x += 1.2) b.box(0.05, R.height, 0.04, wallDark, [x, R.height / 2, R.z1 - 0.02]);
  b.box(12, 0.1, 0.03, blackened, [0, 0.05, R.z1 - 0.015]);
  b.box(0.03, 0.1, 8.6, blackened, [R.x0 + 0.015, 0.05, -0.3]);
  b.box(0.03, 0.1, 3.3, blackened, [R.x1 - 0.015, 0.05, -2.9]);
  b.box(0.03, 0.1, 3.0, blackened, [R.x1 - 0.015, 0.05, 2.5]);
  // Horizontal service rail along side walls.
  b.box(0.06, 0.05, 8.4, darkSteel, [R.x0 + 0.04, 2.55, -0.2]);

  // ---------------------------------------------------------------- window wall
  const tilt = Math.atan2(R.zGlassTop - R.zGlassBottom, R.height); // negative
  // Knee wall + sill
  b.box(12, R.sill, 0.3, wallDark, [0, R.sill / 2, glassZ(R.sill / 2) + 0.12]);
  b.box(12, 0.04, 0.42, steel, [0, R.sill + 0.02, glassZ(R.sill) + 0.08]);
  // Header
  b.box(12, R.height - R.header + 0.02, 0.4, wallDark, [0, (R.header + R.height) / 2, glassZ(R.header) - 0.02]);
  const glassLen = (R.header - R.sill) / Math.cos(tilt);
  const glassMidY = (R.header + R.sill) / 2;
  const glassMidZ = glassZ(glassMidY);
  for (let i = 0; i <= 6; i++) {
    const x = -6 + i * 2;
    b.box(0.12, glassLen, 0.2, darkSteel, [x, glassMidY, glassMidZ - 0.02], [tilt, 0, 0]);
    // exterior cap
    b.box(0.05, glassLen, 0.06, steel, [x, glassMidY, glassMidZ - 0.14], [tilt, 0, 0]);
  }
  // Transom at 2.6m
  {
    const y = 2.62;
    b.box(12, 0.08, 0.16, darkSteel, [0, y, glassZ(y) - 0.02], [tilt, 0, 0]);
  }
  // Handrail
  const railZ = glassZ(1.05) + 0.45;
  b.cyl(0.024, 0.024, 11.7, steel, [0, 1.02, railZ], [0, 0, Math.PI / 2], 12);
  for (let x = -5.5; x <= 5.51; x += 1.83) {
    b.cyl(0.018, 0.018, 0.56, steel, [x, 0.75, railZ], [0, 0, 0], 8);
    b.box(0.05, 0.02, 0.36, steel, [x, 0.5, railZ - 0.16]);
  }

  // Glass panes (split at the transom).
  const glass: THREE.Mesh[] = [];
  const panes: { y0: number; y1: number }[] = [
    { y0: R.sill, y1: 2.58 },
    { y0: 2.66, y1: R.header },
  ];
  for (const pane of panes) {
    const len = (pane.y1 - pane.y0) / Math.cos(tilt);
    const my = (pane.y0 + pane.y1) / 2;
    const gm = createGlassMaterial({ refraction: profile.glassRefraction, width: 1.88, height: len, env });
    for (let i = 0; i < 6; i++) {
      const x = -5 + i * 2;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1.88, len), gm);
      g.position.set(x, my, glassZ(my) - 0.04);
      g.rotation.x = tilt;
      g.renderOrder = 5;
      g.userData.glass = true;
      group.add(g);
      glass.push(g);
    }
  }

  // ---------------------------------------------------------------- exterior ledge
  const ledgeY = 0.28;
  const ledgeMat = createLedgeMaterial();
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(14, 0.12, 1.5), ledgeMat);
  ledge.position.set(0, ledgeY - 0.06, -5.5);
  ledge.receiveShadow = true;
  group.add(ledge);
  // Low gutter lip + fascia dropping away below the ledge.
  b.box(14, 0.1, 0.08, darkSteel, [0, ledgeY + 0.03, -6.22]);
  b.box(14, 1.6, 0.1, darkSteel, [0, ledgeY - 0.86, -6.22]);
  // Exterior mast with obstruction light
  b.cyl(0.05, 0.07, 3.2, steel, [-3.4, ledgeY + 1.6, -5.9], [0, 0, 0], 8);
  b.box(0.5, 0.3, 0.3, darkSteel, [-3.4, ledgeY + 0.15, -5.9]);
  const beaconMat = new THREE.MeshBasicNodeMaterial();
  const blink = smoothstep(float(0.0), float(0.05), fract(time.mul(0.5))).mul(smoothstep(float(0.4), float(0.25), fract(time.mul(0.5))));
  const beaconCol = vec3(1, 0.05, 0.02).mul(blink.mul(8).add(0.1));
  beaconMat.colorNode = beaconCol;
  beaconMat.mrtNode = mrt({ emissive: vec4(beaconCol.mul(0.6), 1) });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), beaconMat);
  beacon.position.set(-3.4, ledgeY + 3.25, -5.9);
  group.add(beacon);

  // ---------------------------------------------------------------- cable tray + hanging cables
  b.box(11.6, 0.04, 0.42, darkSteel, [0, 3.18, -3.9]);
  b.box(11.6, 0.1, 0.02, darkSteel, [0, 3.22, -4.1]);
  b.box(11.6, 0.1, 0.02, darkSteel, [0, 3.22, -3.7]);
  for (let x = -5.5; x <= 5.5; x += 1.1) b.cyl(0.008, 0.008, 0.42, steel, [x, 3.39, -3.9], [0, 0, 0], 4);
  const cableRand = (i: number) => Math.sin(i * 12.9898) * 0.5 + 0.5;
  for (let i = 0; i < 9; i++) {
    const x0 = -5.4 + i * 1.3;
    const a = new THREE.Vector3(x0, 3.22, -3.8 + cableRand(i) * 0.1);
    const c = new THREE.Vector3(x0 + 1.1 + cableRand(i + 3) * 0.3, 3.22, -3.9);
    b.add(cableGeometry(a, c, 0.12 + cableRand(i + 7) * 0.2, 0.012 + cableRand(i + 9) * 0.008), rubber);
  }
  // Drops from the tray to the console riser.
  for (let i = 0; i < 4; i++) {
    const x = -0.9 + i * 0.55;
    b.add(cableGeometry(new THREE.Vector3(x, 3.17, -3.85), new THREE.Vector3(x * 0.8, 1.02, -3.82), -0.05, 0.011), rubber);
  }
  // Floor cables from console to the rack wall.
  b.add(floorCableGeometry([new THREE.Vector3(-1.6, 0.012, -3.1), new THREE.Vector3(-2.6, 0.012, -2.5), new THREE.Vector3(-4.2, 0.012, -2.3), new THREE.Vector3(-4.95, 0.012, -2.0)], 0.012), rubber);
  b.add(floorCableGeometry([new THREE.Vector3(-1.5, 0.018, -3.15), new THREE.Vector3(-2.5, 0.018, -2.6), new THREE.Vector3(-4.1, 0.02, -2.45), new THREE.Vector3(-4.95, 0.02, -1.4)], 0.016), rubber);
  b.add(floorCableGeometry([new THREE.Vector3(2.1, 0.015, -3.0), new THREE.Vector3(2.9, 0.015, -2.2), new THREE.Vector3(4.5, 0.015, -1.9), new THREE.Vector3(5.95, 0.015, -1.6)], 0.014), rubber);

  // ---------------------------------------------------------------- racks (left wall)
  const rackFront = new THREE.MeshStandardNodeMaterial({ metalness: 0.6 });
  rackFront.colorNode = Fn(() => {
    const perf = step(0.5, fract(positionWorld.y.mul(90))).mul(step(0.5, fract(positionWorld.z.mul(90))));
    return mix(vec3(0.03, 0.032, 0.035), vec3(0.005, 0.005, 0.006), perf);
  })();
  rackFront.roughnessNode = float(0.5);
  const racks: THREE.Object3D[] = [];
  const rackGroup = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const z = -2.9 + i * 0.66;
    b.rbox(0.9, 2.1, 0.62, 0.01, blackened, [-5.5, 1.05, z]);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1.9), rackFront);
    front.rotation.y = Math.PI / 2;
    front.position.set(-5.045, 1.08, z);
    rackGroup.add(front);
    racks.push(front);
    b.box(0.02, 1.95, 0.02, steel, [-5.04, 1.08, z + 0.29]);
  }
  group.add(rackGroup);
  // Rack LEDs (instanced; blink pattern from instance index).
  {
    const ledCount = 4 * 36;
    const ledMat = new THREE.MeshBasicNodeMaterial();
    const hsh = hash(instanceIndex);
    const hsh2 = hash(instanceIndex.add(97));
    const rate = mix(float(0.5), float(6), hsh2);
    const on = step(0.45, fract(time.mul(rate).add(hsh.mul(10)))).mul(roomUniforms.racks);
    const standby = step(0.93, hsh).mul(float(1).sub(roomUniforms.racks)).mul(0.6);
    const colGreen = vec3(0.3, 1.0, 0.55);
    const colAmber = vec3(1.0, 0.55, 0.12);
    const c = mix(colGreen, colAmber, step(0.82, hsh2)).mul(on.mul(3).add(standby.mul(2)));
    ledMat.colorNode = c;
    ledMat.mrtNode = mrt({ emissive: vec4(c.mul(0.5), 1) });
    const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, 0.008, 0.02), ledMat, ledCount);
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 36; j++) {
        const z = -2.9 + i * 0.66 - 0.2 + (j % 4) * 0.03;
        const y = 0.35 + Math.floor(j / 4) * 0.17 + (i % 2) * 0.04;
        m.makeTranslation(-5.04, y, z);
        leds.setMatrixAt(k++, m);
      }
    }
    group.add(leds);
  }

  // ---------------------------------------------------------------- door (right wall)
  const dz0 = DOOR.z - DOOR.w / 2;
  const dz1 = DOOR.z + DOOR.w / 2;
  b.box(0.3, DOOR.h + 0.16, 0.12, darkSteel, [R.x1 - 0.1, (DOOR.h + 0.16) / 2, dz0 - 0.06]);
  b.box(0.3, DOOR.h + 0.16, 0.12, darkSteel, [R.x1 - 0.1, (DOOR.h + 0.16) / 2, dz1 + 0.06]);
  b.box(0.3, 0.16, DOOR.w + 0.24, darkSteel, [R.x1 - 0.1, DOOR.h + 0.08, DOOR.z]);
  b.box(0.36, 0.02, DOOR.w, hazard, [R.x1 - 0.12, 0.01, DOOR.z]);
  const doorMat = createPaintedMaterial(0x3a3f45, 0.55, 0.45, 0.2);
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.07, DOOR.h, DOOR.w), doorMat);
  doorLeaf.position.set(R.x1 + 0.02, DOOR.h / 2, DOOR.z);
  doorLeaf.castShadow = true;
  doorLeaf.receiveShadow = true;
  group.add(doorLeaf);
  // Door details: a window slit and a handle recess (children move with the leaf).
  {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.5, 0.08), blackened);
    slit.position.set(0, 0.35, -0.35);
    doorLeaf.add(slit);
    const recess = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.05), steel);
    recess.position.set(-0.01, -0.1, -0.52);
    doorLeaf.add(recess);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.06, DOOR.w), hazard);
    stripe.position.set(0, -DOOR.h / 2 + 0.2, 0);
    doorLeaf.add(stripe);
  }
  // Warm hidden room behind the door: simple lit volume seen through the gap.
  {
    const warmMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    const warm = Fn(() => {
      const yk = smoothstep(float(0), float(2.4), positionWorld.y);
      return vec3(1.0, 0.62, 0.32).mul(roomUniforms.doorGlow.mul(mix(float(1.6), float(0.5), yk)));
    })();
    warmMat.colorNode = warm;
    warmMat.mrtNode = mrt({ emissive: vec4(warm.mul(0.2), 1) });
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, DOOR.h + 0.2, 2.4), warmMat);
    box.position.set(R.x1 + 1.3, (DOOR.h + 0.2) / 2, DOOR.z);
    group.add(box);
  }
  // Door control panel with its own small screen.
  const doorScreen = new Screen(256, 160, 0xffffff, 0.5);
  const doorPanel = new THREE.Group();
  {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.3), darkSteel);
    housing.castShadow = true;
    doorPanel.add(housing);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.15), doorScreen.material);
    scr.rotation.y = -Math.PI / 2;
    scr.position.set(-0.031, 0.08, 0);
    doorPanel.add(scr);
    const keypad = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.14, 0.2), blackened);
    keypad.position.set(-0.03, -0.1, 0);
    doorPanel.add(keypad);
    doorPanel.position.set(R.x1 - 0.03, 1.35, dz0 - 0.45);
    group.add(doorPanel);
  }
  // Emergency lamp above the door.
  const emergencyMat = new THREE.MeshBasicNodeMaterial();
  const emU = uniform(0);
  const emCol = vec3(1.0, 0.08, 0.03).mul(emU.mul(6).add(0.05));
  emergencyMat.colorNode = emCol;
  emergencyMat.mrtNode = mrt({ emissive: vec4(emCol.mul(0.7), 1) });
  const emergencyLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 16), emergencyMat);
  emergencyLamp.rotation.z = Math.PI / 2;
  emergencyLamp.position.set(R.x1 - 0.08, DOOR.h + 0.38, DOOR.z);
  emergencyLamp.userData.u = emU;
  group.add(emergencyLamp);
  b.box(0.06, 0.18, 0.18, darkSteel, [R.x1 - 0.03, DOOR.h + 0.38, DOOR.z]);

  // ---------------------------------------------------------------- console
  const CZ = -3.3;
  b.rbox(3.6, 0.7, 0.6, 0.02, wallDark, [0, 0.39, CZ - 0.05]);
  b.box(3.5, 0.06, 0.56, blackened, [0, 0.03, CZ - 0.05]);
  b.rbox(3.9, 0.05, 0.95, 0.015, deskTop, [0, 0.765, CZ + 0.05]);
  b.box(3.9, 0.012, 0.012, steel, [0, 0.765, CZ + 0.525]);
  // Slanted control deck
  const deckRot = 0.32;
  const deckPos: [number, number, number] = [0, 0.86, CZ - 0.2];
  b.rbox(3.3, 0.05, 0.4, 0.01, darkSteel, deckPos, [deckRot, 0, 0]);
  b.box(3.3, 0.16, 0.05, darkSteel, [0, 0.83, CZ - 0.38]);
  // Riser for monitors
  b.rbox(3.6, 0.36, 0.22, 0.015, wallDark, [0, 0.96, CZ - 0.5]);
  // Deck buttons (instanced, lit by power)
  {
    const btnMat = new THREE.MeshBasicNodeMaterial();
    const hA = hash(instanceIndex);
    const hB = hash(instanceIndex.add(31));
    const palette = mix(mix(vec3(0.95, 0.55, 0.15), vec3(0.4, 0.85, 0.75), step(0.45, hA)), vec3(0.9, 0.9, 0.85), step(0.85, hA));
    const blinkB = step(0.3, fract(time.mul(mix(float(0.2), float(1.5), hB)).add(hB))).mul(step(0.7, hB)).add(step(hB, 0.7));
    const lit = roomUniforms.power.mul(blinkB).mul(step(0.25, hB));
    const bc = mix(vec3(0.02, 0.022, 0.025), palette.mul(2.2), lit);
    btnMat.colorNode = bc;
    btnMat.mrtNode = mrt({ emissive: vec4(palette.mul(lit).mul(0.8), 1) });
    const cols = 26;
    const rows = 4;
    const btns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.014, 0.03), btnMat, cols * rows * 2);
    const deck = new THREE.Object3D();
    deck.position.set(...deckPos);
    deck.rotation.x = deckRot;
    deck.updateMatrixWorld();
    const local = new THREE.Object3D();
    let k = 0;
    for (const side of [-1, 1]) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((c + r * 3) % 7 === 0) continue;
          local.position.set(side * (0.25 + c * 0.052), 0.03, -0.12 + r * 0.075);
          local.updateMatrix();
          const mm = new THREE.Matrix4().multiplyMatrices(deck.matrixWorld, local.matrix);
          btns.setMatrixAt(k++, mm);
        }
      }
    }
    btns.count = k;
    group.add(btns);
  }
  // Monitors
  const screens = {
    center: new Screen(640, 368, 0xeaf6ff, 0.28),
    left: new Screen(448, 272, 0xeaf6ff, 0.28),
    right: new Screen(448, 272, 0xeaf6ff, 0.28),
  };
  const screenMeshes: THREE.Mesh[] = [];
  const monitor = (w: number, h: number, pos: [number, number, number], ry: number, screen: Screen) => {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.05), blackened);
    housing.castShadow = true;
    g.add(housing);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, h * 0.6, 0.06), darkSteel);
    back.position.z = -0.05;
    g.add(back);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screen.material);
    scr.position.z = 0.0255;
    g.add(scr);
    screenMeshes.push(scr);
    g.position.set(...pos);
    g.rotation.y = ry;
    group.add(g);
    b.cyl(0.02, 0.02, 0.3, darkSteel, [pos[0], 1.12, pos[2] - 0.04]);
  };
  monitor(1.0, 0.57, [0, 1.48, CZ - 0.47], 0, screens.center);
  monitor(0.74, 0.44, [-1.02, 1.42, CZ - 0.38], 0.32, screens.left);
  monitor(0.74, 0.44, [1.02, 1.42, CZ - 0.38], -0.32, screens.right);

  // Keyboard, mug, papers, headset hook.
  const keyMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1 });
  keyMat.colorNode = Fn(() => {
    const g = uv().mul(vec3(18, 5, 1).xy);
    const k = step(0.12, fract(g.x)).mul(step(0.15, fract(g.y)));
    return mix(vec3(0.01), vec3(0.035), k);
  })();
  const kb = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.018, 0.15), keyMat);
  kb.position.set(-0.05, 0.8, CZ + 0.3);
  kb.rotation.y = 0.04;
  kb.castShadow = true;
  group.add(kb);
  const ceramic = new THREE.MeshStandardNodeMaterial({ color: 0xb9b4aa, roughness: 0.35, metalness: 0 });
  const mugPts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.036, 0),
    new THREE.Vector2(0.04, 0.005),
    new THREE.Vector2(0.041, 0.1),
    new THREE.Vector2(0.037, 0.1),
    new THREE.Vector2(0.036, 0.012),
    new THREE.Vector2(0, 0.012),
  ];
  const mug = new THREE.Mesh(new THREE.LatheGeometry(mugPts, 24), ceramic);
  mug.position.set(-1.25, 0.79, CZ + 0.28);
  mug.castShadow = true;
  group.add(mug);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 16, Math.PI), ceramic);
  handle.position.set(-1.25 + 0.041, 0.84, CZ + 0.28);
  handle.rotation.z = -Math.PI / 2;
  group.add(handle);
  const paper = new THREE.MeshStandardNodeMaterial({ color: 0x9a9890, roughness: 0.9 });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.002, 0.297), paper);
  p1.position.set(0.95, 0.791, CZ + 0.25);
  p1.rotation.y = -0.3;
  p1.receiveShadow = true;
  group.add(p1);
  const p2 = p1.clone();
  p2.position.set(1.05, 0.793, CZ + 0.2);
  p2.rotation.y = 0.15;
  group.add(p2);

  // ---------------------------------------------------------------- chair
  const chair = new THREE.Group();
  {
    const cb = new Batch();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      cb.box(0.3, 0.03, 0.04, darkSteel, [Math.cos(a) * 0.15, 0.06, Math.sin(a) * 0.15], [0, -a, 0]);
      cb.add(new THREE.SphereGeometry(0.025, 8, 6), rubber, [Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29]);
    }
    cb.cyl(0.025, 0.025, 0.36, steel, [0, 0.26, 0]);
    cb.rbox(0.5, 0.08, 0.48, 0.03, rubber, [0, 0.47, 0]);
    cb.box(0.04, 0.35, 0.03, darkSteel, [0, 0.62, 0.22]);
    cb.rbox(0.46, 0.5, 0.07, 0.03, rubber, [0, 0.95, 0.26], [-0.12, 0, 0]);
    cb.build(chair);
    chair.position.set(0.55, 0, CZ + 1.05);
    chair.rotation.y = 0.5;
    group.add(chair);
  }

  // ---------------------------------------------------------------- breaker pedestal
  const breakerGroup = new THREE.Group();
  const breakerAnchor = new THREE.Vector3(2.45, 0.95, CZ + 0.28);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.05, 0.42), createPaintedMaterial(0x34383d, 0.6, 0.3, 0.3));
  body.position.set(2.45, 0.525, CZ + 0.05);
  body.castShadow = true;
  body.receiveShadow = true;
  breakerGroup.add(body);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.02), blackened);
  plate.position.set(2.45, 0.86, CZ + 0.27);
  breakerGroup.add(plate);
  // Lever: pivot at plate centre, arm points up (off) → down (on).
  const lever = new THREE.Group();
  lever.position.set(2.45, 0.86, CZ + 0.3);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), steel);
  arm.position.y = 0.08;
  lever.add(arm);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 12), createPaintedMaterial(0x8a1c14, 0.4, 0.1, 0.1));
  grip.rotation.z = Math.PI / 2;
  grip.position.y = 0.165;
  lever.add(grip);
  lever.rotation.x = 0.35;
  breakerGroup.add(lever);
  // Hinged hazard cover over the lever.
  const cover = new THREE.Group();
  cover.position.set(2.45, 1.07, CZ + 0.3);
  const coverMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.012), hazard);
  coverMesh.position.set(0, -0.2, 0.06);
  cover.add(coverMesh);
  breakerGroup.add(cover);
  // Standby LED + label.
  const standbyMat = new THREE.MeshBasicNodeMaterial();
  const sb = roomUniforms.standby.mul(sin(time.mul(3.2)).mul(0.5).add(0.5).pow(3).mul(5).add(0.2));
  const sbCol = vec3(1.0, 0.45, 0.08).mul(sb);
  standbyMat.colorNode = sbCol;
  standbyMat.mrtNode = mrt({ emissive: vec4(sbCol.mul(0.9), 1) });
  const standbyLed = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), standbyMat);
  standbyLed.position.set(2.62, 1.1, CZ + 0.28);
  breakerGroup.add(standbyLed);
  const label = decal(signTexture([{ text: "MAIN BUS 07", size: 26 }, { text: "MANUAL RESET", size: 18, color: "#8c9197" }], 512, 110), 0.3, 0.064, 0.85);
  label.position.set(2.45, 0.6, CZ + 0.261);
  breakerGroup.add(label);
  group.add(breakerGroup);

  // ---------------------------------------------------------------- signage
  const obs = decal(signTexture([{ text: "OBS—07", size: 84, color: "#b8bdc2", weight: 700 }, { text: "OBSERVATION / SIGNAL ANALYSIS", size: 20, color: "#7d838a" }], 1024, 220), 2.2, 0.47, 0.55);
  obs.position.set(R.x0 + 0.03, 2.95, 1.2);
  obs.rotation.y = Math.PI / 2;
  group.add(obs);
  const auth = decal(signTexture([{ text: "AUTHORISED ACCESS", size: 30 }, { text: "IDENTITY REQUIRED", size: 22, color: "#c07b35" }], 512, 110), 0.62, 0.13, 0.75);
  auth.position.set(R.x1 - 0.03, 1.72, dz0 - 0.45);
  auth.rotation.y = -Math.PI / 2;
  group.add(auth);

  // ---------------------------------------------------------------- leak drip
  const dripMat = new THREE.MeshStandardNodeMaterial({ color: 0x9fb3c5, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.8 });
  const drip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), dripMat);
  drip.scale.set(1, 1.6, 1);
  drip.position.set(LEAK.x, R.height - 0.1, LEAK.z);
  group.add(drip);
  // Water stain on the ceiling
  {
    const stain = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: 0.3 });
    stain.colorNode = vec3(0.01, 0.009, 0.008);
    stain.opacityNode = Fn(() => {
      const d = uv().sub(0.5).length().mul(2);
      const n = mx_noise_float(vec3(uv().mul(6), 1)).mul(0.3);
      return smoothstep(float(1), float(0.3), d.add(n)).mul(0.7);
    })();
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), stain);
    sm.rotation.x = Math.PI / 2;
    sm.position.set(LEAK.x, R.height - 0.005, LEAK.z);
    group.add(sm);
  }

  b.build(group);

  // ---------------------------------------------------------------- lights
  const city = new THREE.DirectionalLight(0x6f86a8, 0.9);
  city.position.set(-6, 14, -30);
  city.target.position.set(0, 0, 0);
  group.add(city, city.target);
  const ambient = new THREE.HemisphereLight(0x1c2330, 0x050506, 0.35);
  group.add(ambient);
  const emergency = new THREE.PointLight(0xff2a10, 0, 16, 1.3);
  emergency.position.set(R.x1 - 0.4, DOOR.h + 0.3, DOOR.z);
  group.add(emergency);
  const ceiling: THREE.SpotLight[] = [];
  const spotDefs: [number, number, number, number, boolean][] = [
    [0, 3.3, -2.9, 0.95, true],
    [-2.6, 3.3, -0.6, 0.9, false],
    [2.6, 3.3, 0.2, 0.9, false],
  ];
  if (profile.level === "low") spotDefs.splice(1, 1);
  for (const [x, y, z, angle, shadow] of spotDefs) {
    const s = new THREE.SpotLight(0xffe2c0, 0, 11, angle, 0.65, 1.4);
    s.position.set(x, y, z);
    s.target.position.set(x * 0.9, 0, z + 0.3);
    if (shadow && profile.shadows) {
      s.castShadow = true;
      s.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.02;
      s.shadow.camera.near = 0.3;
      s.shadow.camera.far = 8;
      s.shadow.autoUpdate = false;
      s.shadow.needsUpdate = true;
    }
    group.add(s, s.target);
    ceiling.push(s);
  }
  const consoleLight = new THREE.PointLight(0xa8d4ff, 0, 4.5, 1.8);
  consoleLight.position.set(0, 1.45, CZ + 0.1);
  group.add(consoleLight);
  const doorLight = new THREE.PointLight(0xffa860, 0, 7, 1.5);
  doorLight.position.set(R.x1 - 0.2, 1.6, DOOR.z);
  group.add(doorLight);
  // Wall-washer over the door: off until the system asks who you are.
  const doorWash = new THREE.SpotLight(0xdfe8f0, 0, 6, 0.75, 0.8, 1.5);
  doorWash.position.set(R.x1 - 1.6, 3.2, DOOR.z - 0.2);
  doorWash.target.position.set(R.x1, 1.2, DOOR.z - 0.3);
  group.add(doorWash, doorWash.target);
  const flash = new THREE.DirectionalLight(0xc8d6ff, 0);
  flash.position.set(-10, 25, -40);
  group.add(flash);

  return {
    group,
    floor: floor_,
    glass,
    consoleScreens: screens,
    screenMeshes,
    doorScreen,
    doorLeaf,
    doorPanel,
    breaker: { body: breakerGroup, cover, lever, anchor: breakerAnchor },
    racks,
    drip,
    chair,
    lights: { city, ambient, emergency, ceiling, console: consoleLight, door: doorLight, doorWash, flash },
    emergencyLamp,
    ledgeY,
  };
}
