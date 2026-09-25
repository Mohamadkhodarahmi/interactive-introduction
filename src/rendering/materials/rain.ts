import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  float,
  fract,
  hash,
  instanceIndex,
  length,
  mix,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  cameraPosition,
  max,
  sin,
} from "three/tsl";
import { asV3 } from "./tslUtils";

export const rainUniforms = {
  /** 0..1: fraction of streaks visible + opacity. */
  intensity: uniform(0.55),
  wind: uniform(0.18),
  speed: uniform(10),
  /** Colour/brightness of light scattered in the drops. */
  tint: uniform(new THREE.Color(0.55, 0.62, 0.72)),
  brightness: uniform(0.55),
};

export interface RainVolume {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * GPU rain streaks as instanced camera-facing sprites. Every streak derives its
 * start position, speed and length from hash(instanceIndex); falling is pure
 * `fract(time·speed)`, so there is no per-frame CPU or storage-buffer work and it
 * runs identically on the WebGL2 fallback.
 */
export function createRainMaterial(volume: RainVolume): THREE.SpriteNodeMaterial {
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const size = new THREE.Vector3().subVectors(volume.max, volume.min);

  const h1 = hash(instanceIndex);
  const h2 = hash(instanceIndex.add(4099));
  const h3 = hash(instanceIndex.add(8191));
  const h4 = hash(instanceIndex.add(12289));

  const u = rainUniforms;
  const speed = u.speed.mul(mix(float(0.85), float(1.2), h4));
  const fall = fract(h3.add(time.mul(speed).div(size.y)));
  const y = float(volume.max.y).sub(fall.mul(size.y));
  // Depth distribution biased toward the viewer so near streaks read as rain.
  const zK = h2.mul(h2);
  const x = float(volume.min.x).add(h1.mul(size.x)).add(fall.mul(size.y).mul(u.wind));
  const z = float(volume.max.z).sub(zK.mul(size.z));
  const pos = vec3(x, y, z);
  mat.positionNode = pos;

  const dist = length(pos.sub(cameraPosition));
  const len = mix(float(0.35), float(0.8), h4).mul(max(float(1), dist.mul(0.06)));
  const width = max(float(0.006), dist.mul(0.0011));
  mat.scaleNode = vec2(width, len);
  mat.rotationNode = u.wind.mul(-0.9);

  const visible = step(h1.mul(0.7).add(h4.mul(0.3)), u.intensity);
  mat.colorNode = Fn(() => {
    const p = uv();
    const across = smoothstep(float(0.5), float(0.0), abs(p.x.sub(0.5)));
    const along = smoothstep(float(0.0), float(0.35), p.y).mul(smoothstep(float(1.0), float(0.8), p.y));
    const near = smoothstep(float(60), float(3), dist);
    const shimmer = sin(time.mul(20).add(h1.mul(50))).mul(0.2).add(0.8);
    const a = across.mul(along).mul(visible).mul(mix(float(0.18), float(0.55), near)).mul(shimmer);
    return vec4(asV3(u.tint).mul(u.brightness).mul(a), a);
  })();
  return mat;
}

/** Tiny splash sprites on a horizontal surface (ledge, rooftops of nearby details). */
export function createSplashMaterial(area: { x0: number; x1: number; z0: number; z1: number; y: number }): THREE.SpriteNodeMaterial {
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const h1 = hash(instanceIndex);
  const h2 = hash(instanceIndex.add(311));
  const h3 = hash(instanceIndex.add(733));
  const rate = mix(float(1.2), float(2.4), h3);
  const cycle = time.mul(rate).add(h3.mul(10));
  const t = fract(cycle);
  // Re-seed the position every cycle so splashes don't repeat in place.
  const k = cycle.sub(t);
  const rx = fract(h1.add(k.mul(0.618)));
  const rz = fract(h2.add(k.mul(0.382)));
  const pos = vec3(mix(float(area.x0), float(area.x1), rx), float(area.y).add(t.mul(0.03)), mix(float(area.z0), float(area.z1), rz));
  mat.positionNode = pos;
  const s = mix(float(0.01), float(0.06), t);
  mat.scaleNode = vec2(s, s.mul(0.6));
  const visible = step(h2, rainUniforms.intensity);
  mat.colorNode = Fn(() => {
    const p = uv().sub(0.5).mul(2);
    const r = length(p);
    const ring = smoothstep(float(1), float(0.7), r).mul(smoothstep(float(0.3), float(0.75), r));
    const a = ring.mul(float(1).sub(t)).mul(0.5).mul(visible);
    return vec4(asV3(rainUniforms.tint).mul(rainUniforms.brightness).mul(a).mul(1.5), a);
  })();
  return mat;
}
