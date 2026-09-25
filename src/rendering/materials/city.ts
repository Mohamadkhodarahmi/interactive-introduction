import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  length,
  max,
  min,
  mix,
  mrt,
  normalWorld,
  positionWorld,
  cameraPosition,
  select,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  mx_noise_float,
  uv,
} from "three/tsl";
import { hash21, type N } from "./tslUtils";

/** Uniforms shared by every city material so the director can drive them. */
export const cityUniforms = {
  /** Radius (m) of the powered district around the facility, grows on restore. */
  powerRadius: uniform(0),
  /** Beyond this distance the grid was never down. */
  blackoutRadius: uniform(780),
  /** Global window brightness multiplier. */
  brightness: uniform(0.75),
  /** Lightning flash 0..1. */
  flash: uniform(0),
};

/** 1 when the point is powered (either outside the blackout or reached by the wave). */
export const poweredAt = Fn(([p, jitter]: [N, N]) => {
  const d = length(vec2(p.x, p.z));
  const u = cityUniforms;
  const reached = step(d.add(jitter.mul(140)), u.powerRadius);
  const far = smoothstep(u.blackoutRadius, u.blackoutRadius.add(160), d.add(jitter.mul(120)));
  return max(reached, far);
});

/**
 * Building façades. Windows are generated from world position so no UVs or
 * textures are needed; each building has its own seed (instance index) that
 * decides occupancy, colour temperature and the office/residential mix.
 */
export function createBuildingMaterial(): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  const seed = varying(hash(instanceIndex));
  const seed2 = varying(hash(instanceIndex.add(7919)));

  const windows = Fn(() => {
    const p = positionWorld;
    const n = normalWorld;
    const isX = step(0.5, abs(n.x));
    const isTop = step(0.5, n.y);
    const u = mix(p.x, p.z, isX);
    const v = p.y;

    // Building type: offices have wide ribbon windows and cooler light.
    const office = step(0.55, seed);
    const cellW = mix(float(3.4), float(4.4), office);
    const cellH = mix(float(3.1), float(3.9), office);
    const cu = u.div(cellW);
    const cv = v.div(cellH);
    const cell = floor(vec2(cu, cv));
    const local = fract(vec2(cu, cv));
    const winX = mix(float(0.24), float(0.1), office);
    const winYlo = mix(float(0.3), float(0.26), office);
    const winYhi = mix(float(0.8), float(0.86), office);
    const aa = float(0.06);
    const inWin = smoothstep(winX, winX.add(aa), local.x)
      .mul(smoothstep(float(1).sub(winX), float(1).sub(winX).sub(aa), local.x))
      .mul(smoothstep(winYlo, winYlo.add(aa), local.y))
      .mul(smoothstep(winYhi, winYhi.sub(aa), local.y));
    // Structural bays: on some buildings every Nth column is a solid pier.
    const bayN = floor(mix(float(3), float(7), seed2));
    const pierCol = step(fract(cell.x.div(bayN).add(0.001)), float(0.999).div(bayN));
    const pier = float(1).sub(pierCol.mul(step(0.45, seed2)));

    const r = hash21(cell.add(vec2(seed.mul(173.1), seed2.mul(311.7))));
    const r2 = hash21(cell.mul(1.37).add(vec2(seed2.mul(91.3), 17.1)));
    // Occupancy: offices light whole floors, homes are scattered.
    const floorR = hash21(vec2(cell.y, seed.mul(53.0)));
    const occupancy = mix(float(0.12), float(0.34), seed2).add(office.mul(step(0.6, floorR)).mul(0.45));
    const lit = step(r, occupancy);

    // Colour temperature: mostly warm/neutral, occasional pale fluorescent.
    const warm = vec3(1.0, 0.55, 0.22);
    const neutral = vec3(1.0, 0.78, 0.52);
    const cool = vec3(0.78, 0.88, 1.0);
    const tint = mix(mix(warm, neutral, office.mul(0.6).add(r2.mul(0.4))), cool, step(0.9, r2).mul(office).mul(0.7));
    // Blinds / curtains dim some windows; brightness varies a lot.
    const blind = mix(float(1), smoothstep(float(0.95), float(0.4), local.y).mul(0.75).add(0.25), step(0.55, hash21(cell.add(33.3))));
    const intensity = r2.mul(r2).mul(1.1).add(0.12).mul(blind);

    const powered = poweredAt(p, r);
    const glow = inWin.mul(lit).mul(powered).mul(intensity).mul(pier);

    // Distance LOD: far away, windows average out instead of shimmering.
    const dist = length(p.sub(cameraPosition));
    const lod = smoothstep(float(700), float(2200), dist);
    const avg = occupancy.mul(0.22).mul(powered).mul(mix(float(0.5), float(0.9), seed2));
    const g = mix(glow, avg, lod).mul(float(1).sub(isTop));

    return vec4(tint, g);
  })();

  // Façade base: dark concrete/glass, unlit glass slightly bluer, faint sky light at the top.
  const base = Fn(() => {
    const p = positionWorld;
    const n = normalWorld;
    const isTop = step(0.5, n.y);
    const skyTerm = smoothstep(float(-140), float(200), p.y).mul(0.02);
    const grime = mx_noise_float(p.mul(vec3(0.05, 0.3, 0.05))).mul(0.004);
    const wall = vec3(0.011, 0.011, 0.013).add(vec3(0.5, 0.52, 0.6).mul(skyTerm)).add(grime);
    const roof = vec3(0.01, 0.011, 0.013);
    const flash = cityUniforms.flash.mul(vec3(0.35, 0.4, 0.55)).mul(max(n.y, float(0.25)));
    return mix(wall, roof, isTop).add(flash);
  })();

  const lightCol = windows.xyz.mul(windows.w).mul(cityUniforms.brightness).mul(1.1);
  mat.colorNode = base.add(lightCol);
  mat.mrtNode = mrt({ emissive: vec4(lightCol.mul(0.18), 1) });
  return mat;
}

/** Ground far below: asphalt, sodium road glow on a grid, faint wet sheen. */
export function createGroundMaterial(roadSpacing: number): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  const col = Fn(() => {
    const p = positionWorld;
    const g = vec2(p.x, p.z).div(roadSpacing).add(0.5);
    const f = abs(fract(g).sub(0.5)).mul(roadSpacing);
    const d = min(f.x, f.y);
    const road = smoothstep(float(7), float(1.5), d);
    const halo = smoothstep(float(26), float(0), d).mul(0.3);
    const cell = floor(g);
    const powered = poweredAt(p, hash21(cell));
    const sodium = vec3(1.0, 0.5, 0.18);
    const glow = sodium.mul(road.mul(0.07).add(halo.mul(0.05))).mul(powered);
    const noise = mx_noise_float(p.mul(0.02)).mul(0.004).add(0.006);
    return vec3(noise, noise, noise.mul(1.1)).add(glow.mul(cityUniforms.brightness));
  })();
  mat.colorNode = col;
  return mat;
}

/**
 * Instanced sprites for traffic and street lamps. Positions derive from the
 * instance index so nothing is uploaded per frame.
 */
export function createTrafficMaterial(opts: { roadSpacing: number; extent: number; groundY: number }): THREE.SpriteNodeMaterial {
  const { roadSpacing, extent, groundY } = opts;
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const i = instanceIndex.toFloat();
  const hA = hash(instanceIndex);
  const hB = hash(instanceIndex.add(1013));
  const hC = hash(instanceIndex.add(2027));
  const roads = Math.floor((extent * 2) / roadSpacing);
  const alongX = step(0.5, hA);
  const roadIndex = floor(hB.mul(roads)).sub(roads / 2);
  const roadCoord = roadIndex.mul(roadSpacing);
  const dir = select(hC.greaterThan(0.5), float(1), float(-1));
  const lane = dir.mul(3.5);
  const speed = mix(float(9), float(19), hash(instanceIndex.add(77)));
  const len = extent * 2;
  const s = fract(hash(instanceIndex.add(3)).add(time.mul(speed).div(len).mul(dir))).mul(len).sub(extent);
  const x = mix(roadCoord.add(lane), s, alongX);
  const z = mix(s, roadCoord.add(lane), alongX);
  const pos = vec3(x, float(groundY + 1.2), z);
  mat.positionNode = pos;

  const powered = poweredAt(pos, hash(instanceIndex.add(5)));
  // Head vs tail light depends on whether the car moves toward the viewer.
  const toward = step(0.0, dir.mul(mix(float(1), float(0.3), alongX)));
  const head = vec3(1.0, 0.86, 0.66);
  const tail = vec3(1.0, 0.1, 0.05);
  const c = mix(tail, head, toward);
  const distToCam = length(pos.sub(cameraPosition));
  // Keep lights at least ~1.5 px wide regardless of distance.
  const size = max(float(3.5), distToCam.mul(0.0058));
  mat.scaleNode = vec2(size, size);
  // Twinkle a little (occlusion by buildings / other cars).
  const flicker = sin(time.mul(3).add(i.mul(1.7))).mul(0.15).add(0.85);
  const strength = mix(float(0.55), float(1.1), hA).mul(powered).mul(flicker).mul(cityUniforms.brightness);
  mat.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const a = smoothstep(float(1), float(0), d).pow(2.2);
    return vec4(c.mul(strength).mul(a).mul(1.4), float(1));
  })();
  mat.mrtNode = mrt({ emissive: vec4(c.mul(strength).mul(0.4), 1) });
  return mat;
}

export function createStreetLampMaterial(opts: { roadSpacing: number; extent: number; groundY: number; spacing: number }): THREE.SpriteNodeMaterial {
  const { roadSpacing, extent, groundY, spacing } = opts;
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const perRoad = Math.floor((extent * 2) / spacing);
  const roads = Math.floor((extent * 2) / roadSpacing);
  const idx = instanceIndex.toFloat();
  const road = floor(idx.div(perRoad * 2));
  const k = idx.mod(perRoad * 2);
  const side = step(perRoad, k);
  const along = k.mod(perRoad).mul(spacing).sub(extent);
  const axisX = step(roads, road);
  const roadCoord = floor(road.mod(roads).sub(roads / 2)).mul(roadSpacing);
  const off = side.mul(2).sub(1).mul(8);
  const x = mix(roadCoord.add(off), along, axisX);
  const z = mix(along, roadCoord.add(off), axisX);
  const pos = vec3(x, float(groundY + 8), z);
  mat.positionNode = pos;
  const powered = poweredAt(pos, hash(instanceIndex.add(9)));
  const dist = length(pos.sub(cameraPosition));
  const size = max(float(5), dist.mul(0.0068));
  mat.scaleNode = vec2(size, size);
  const c = vec3(1.0, 0.55, 0.2);
  mat.colorNode = Fn(() => {
    const d = length(uv().sub(0.5)).mul(2);
    const a = smoothstep(float(1), float(0), d).pow(2.5);
    return vec4(c.mul(a).mul(powered).mul(0.8).mul(cityUniforms.brightness), float(1));
  })();
  return mat;
}

/** Red aviation obstruction lights on tall roofs (blink in sync groups). */
export function createBeaconMaterial(): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  const seed = hash(instanceIndex);
  const phase = floor(seed.mul(3)).div(3);
  const blink = smoothstep(float(0.0), float(0.08), fract(time.mul(0.5).add(phase)))
    .mul(smoothstep(float(0.5), float(0.3), fract(time.mul(0.5).add(phase))));
  const c = vec3(1.0, 0.06, 0.03).mul(blink.mul(6).add(0.15));
  mat.colorNode = c;
  mat.mrtNode = mrt({ emissive: vec4(c.mul(0.8), 1) });
  return mat;
}
