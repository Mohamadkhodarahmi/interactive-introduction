import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewportSharedTexture,
  transformNormalToView,
  dot,
  cameraPosition,
  reflect,
  pmremTexture,
  clamp,
  normalWorld,
} from "three/tsl";
import { hash21, hash22, asV3, type N } from "./tslUtils";


// ----------------------------------------------------------------- ripples

/**
 * Rain ripple normal offset for a horizontal surface at world xz `p` (metres).
 * Four neighbouring cells, each emitting one expanding ring per cycle.
 */
export const ripples = Fn(([pIn, scale, rate]: [N, N, N]) => {
  const p = vec2(pIn).mul(scale);
  const base = floor(p.sub(0.5));
  const acc = vec2(0).toVar();
  for (const [ox, oy] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const cell = base.add(vec2(ox, oy));
    const center = cell.add(hash22(cell));
    const ph = fract(time.mul(rate).add(hash21(cell.add(19.7))));
    const v = p.sub(center);
    const d = length(v);
    const radius = ph.mul(0.9);
    const ring = sin(d.sub(radius).mul(28)).mul(smoothstep(float(0.12), float(0.0), abs(d.sub(radius))));
    const fade = float(1).sub(ph).mul(float(1).sub(ph));
    acc.addAssign(normalize(v.add(0.0001)).mul(ring).mul(fade));
  }
  return acc.mul(0.25);
});

// ----------------------------------------------------------------- glass

export const glassUniforms = {
  rain: uniform(0.55),
  /** 0..1 storm exposure: more, bigger, faster drops (approach branch). */
  storm: uniform(0),
  /** Interior reflection strength (grows when the room is lit). */
  reflection: uniform(0.05),
  tint: uniform(new THREE.Color(0.8, 0.86, 0.9)),
};

/** Static beads in a jittered grid; returns (normal.xy, mask). */
const beads = Fn(([p, cell, t, density]: [N, N, N, N]) => {
  const g = vec2(p).div(cell);
  const id = floor(g);
  const f = fract(g).sub(0.5);
  const h = hash22(id);
  const h3 = hash21(id.add(7.31));
  const pos = h.sub(0.5).mul(0.55);
  const r = mix(float(0.12), float(0.34), h3.mul(h3));
  const d = f.sub(pos);
  const dl = length(d);
  // Drops appear and evaporate over time.
  const life = fract(t.mul(mix(float(0.03), float(0.09), h.x)).add(h3));
  const present = step(h.y, density).mul(smoothstep(float(0.0), float(0.05), life)).mul(smoothstep(float(1.0), float(0.8), life));
  const mask = smoothstep(r, r.mul(0.6), dl).mul(present);
  return vec3(d.div(r).mul(mask), mask);
});

const hashOffset = Fn(([c]: [N]) => hash21(vec2(c, 1.7)));

/** Sliding drops with trails. p in metres, pane-local, y up. */
const slides = Fn(([p, t, amount, height]: [N, N, N, N]) => {
  const q = vec2(p);
  const w = float(0.09);
  const col = floor(q.x.div(w));
  const lx = fract(q.x.div(w)).sub(0.5);
  const hs = hash21(vec2(col, 3.1));
  const speed = mix(float(0.05), float(0.28), hs.mul(hs));
  const active = step(hash21(vec2(col, 9.7)), amount);
  const cycleLen = height.mul(1.4);
  const head = height.sub(fract(t.mul(speed).div(cycleLen).add(hashOffset(col))).mul(cycleLen));
  const wig = sin(q.y.mul(9).add(hs.mul(20))).mul(0.12).add(sin(q.y.mul(23)).mul(0.05));
  const dx = lx.sub(wig).mul(w);
  const dy = q.y.sub(head);
  const r = mix(float(0.0045), float(0.009), hs);
  const d = vec2(dx, dy.mul(0.75));
  const dl = length(d);
  const headMask = smoothstep(r, r.mul(0.5), dl);
  // Trail: thin wet streak above the head plus a few left-behind droplets.
  const above = smoothstep(float(0), float(0.01), dy).mul(smoothstep(float(0.5), float(0.0), dy));
  const trail = smoothstep(r.mul(0.35), float(0), abs(dx)).mul(above).mul(0.6);
  const dropletY = fract(q.y.mul(22).add(hs.mul(7))).sub(0.5);
  const droplet = smoothstep(float(0.18), float(0.05), length(vec2(dx.div(w).mul(3), dropletY))).mul(above).mul(step(0.5, hash21(vec2(col, floor(q.y.mul(22))))));
  const mask = max(headMask, max(trail, droplet)).mul(active);
  const n = d.div(r).mul(headMask).add(vec2(dx.div(r).mul(trail.add(droplet)), 0));
  return vec3(n.mul(active), mask);
});

export interface GlassOptions {
  refraction: boolean;
  width: number;
  height: number;
  env?: THREE.Texture | null;
}

/**
 * Window glass with rain. With refraction the already-rendered scene behind the
 * pane is sampled through `viewportSharedTexture` and bent by the drop normals;
 * without it (low quality) drops are shaded as bright beads over a clear pane.
 */
export function createGlassMaterial(opts: GlassOptions): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const u = glassUniforms;
  const W = opts.width;
  const H = opts.height;

  const drops = Fn(() => {
    const p = uv().mul(vec2(W, H));
    const t = time;
    const density = u.rain.mul(0.55).add(u.storm.mul(0.35));
    const b1 = beads(p, float(0.028), t, density);
    const b2 = beads(p.add(vec2(3.7, 1.3)), mix(float(0.05), float(0.07), u.storm), t.mul(1.3), density.mul(0.7));
    const s = slides(p, t.mul(mix(float(1), float(2.2), u.storm)), u.rain.mul(0.35).add(u.storm.mul(0.45)), float(H));
    const n = b1.xy.add(b2.xy).add(s.xy);
    const m = clamp(b1.z.add(b2.z).add(s.z), 0, 1);
    return vec3(n, m);
  })();

  const n = drops.xy;
  const m = drops.z;

  // Reflection of the room (env) – Fresnel-weighted.
  const viewDir = normalize(positionWorld.sub(cameraPosition));
  const env = opts.env ?? null;

  if (opts.refraction) {
    mat.transparent = true;
    mat.colorNode = Fn(() => {
      // Drops act as tiny lenses: bend the view strongly inside, darken the rim.
      const offset = n.mul(0.0075);
      const behind = viewportSharedTexture(screenUV.add(offset)).rgb;
      const clearView = viewportSharedTexture(screenUV).rgb;
      const rim = smoothstep(float(0.35), float(0.95), length(n)).mul(m);
      const lens = behind.mul(float(1).sub(rim.mul(0.55)));
      let col = mix(clearView, lens, m).mul(asV3(u.tint));
      if (env) {
        const r = reflect(viewDir, normalWorld);
        const fres = pow(float(1).sub(abs(dot(viewDir, normalWorld))), float(3)).mul(0.6).add(0.08);
        col = col.add(pmremTexture(env, r, float(0.06)).rgb.mul(u.reflection).mul(fres));
      }
      return vec4(col, 1);
    })();
  } else {
    mat.colorNode = Fn(() => {
      const hi = pow(clamp(n.y.mul(-0.5).add(0.5), 0, 1), float(3));
      let col = vec3(0.45, 0.52, 0.62).mul(hi.mul(0.25).add(0.04)).mul(m);
      let alpha = m.mul(0.45).add(0.05);
      if (env) {
        const r = reflect(viewDir, normalWorld);
        const fres = pow(float(1).sub(abs(dot(viewDir, normalWorld))), float(3)).mul(0.6).add(0.08);
        const refl = pmremTexture(env, r, float(0.06)).rgb.mul(u.reflection).mul(fres);
        col = col.add(refl);
        alpha = alpha.add(dot(refl, vec3(0.33)).mul(2));
      }
      return vec4(col, clamp(alpha, 0, 0.9));
    })();
  }
  return mat;
}

// ----------------------------------------------------------------- interior surfaces

/**
 * Raised access floor: 60 cm tiles, seams, per-tile roughness, a wet patch under
 * the ceiling leak. With `reflection` (planar reflection texture node sampler),
 * wet areas mirror the room sharply and dry tiles get a soft, blurred sheen.
 */
export function createFloorMaterial(leak: THREE.Vector3, reflection: ((uv: N) => N) | null): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.25 });
  const tile = 0.6;
  const p = positionWorld;
  const g = vec2(p.x, p.z).div(tile);
  const id = floor(g);
  const f = fract(g);
  const seam = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y)));
  const seamMask = smoothstep(float(0.0), float(0.012), seam);
  const tr = hash21(id);
  const grime = mx_fractal_noise_float(vec3(p.x, 0, p.z).mul(1.7), 3, 2, 0.5).mul(0.5).add(0.5);
  const scuff = mx_noise_float(vec3(p.x.mul(9), 1, p.z.mul(2.5))).mul(0.5).add(0.5);

  const dLeak = length(vec2(p.x.sub(leak.x), p.z.sub(leak.z)));
  const puddleEdge = mx_noise_float(vec3(p.x.mul(2.5), 3, p.z.mul(2.5))).mul(0.25);
  const wet = smoothstep(float(0.95), float(0.55), dLeak.add(puddleEdge));
  const damp = smoothstep(float(1.8), float(0.6), dLeak.add(puddleEdge.mul(2)));

  const baseCol = mix(vec3(0.034, 0.036, 0.04), vec3(0.052, 0.054, 0.058), tr.mul(0.6).add(grime.mul(0.4)));
  mat.colorNode = baseCol.mul(seamMask.mul(0.7).add(0.3)).mul(float(1).sub(wet.mul(0.4)));
  const rough = mix(float(0.36), float(0.6), tr).add(scuff.mul(0.12)).sub(grime.mul(0.08));
  const roughFinal = mix(mix(rough, rough.mul(0.6), damp), float(0.04), wet);
  mat.roughnessNode = roughFinal;
  mat.metalnessNode = mix(float(0.3), float(0.0), wet);

  const rip = ripples(vec2(p.x, p.z), float(3.2), float(0.9)).mul(wet);
  const worldN = normalize(vec3(rip.x.mul(0.6), 1, rip.y.mul(0.6)));
  mat.normalNode = transformNormalToView(worldN);

  if (reflection) {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const cosT = clamp(viewDir.y, 0, 1);
    const fres = float(0.04).add(float(0.96).mul(pow(float(1).sub(cosT), float(5))));
    const warp = rip.mul(0.03);
    const spread = roughFinal.mul(0.018);
    const jitter = hash22(id.add(floor(p.x.mul(40)))).sub(0.5).mul(0.002);
    const uv0 = warp.add(jitter);
    const r = reflection(uv0.add(vec2(spread, 0)))
      .add(reflection(uv0.sub(vec2(spread, 0))))
      .add(reflection(uv0.add(vec2(0, spread.mul(1.6)))))
      .add(reflection(uv0.sub(vec2(0, spread.mul(1.6)))))
      .mul(0.25);
    const strength = mix(float(0.35), float(1.0), max(wet, damp.mul(0.6))).mul(seamMask.mul(0.5).add(0.5));
    const refl = r.rgb.mul(fres.mul(1.4).add(0.06)).mul(strength);
    mat.emissiveNode = refl;
    mat.mrtNode = mrt({ emissive: vec4(refl.mul(0.08), 1) });
  }
  return mat;
}

/** Wet exterior ledge beyond the glass (ripples + splashes read against city light). */
export function createLedgeMaterial(): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.6, roughness: 0.15 });
  const p = positionWorld;
  const n = mx_noise_float(vec3(p.x.mul(1.3), 0, p.z.mul(1.3)));
  mat.colorNode = vec3(0.03, 0.032, 0.036).mul(n.mul(0.2).add(0.9));
  mat.roughnessNode = float(0.08).add(n.mul(0.06).add(0.06));
  const rip = ripples(vec2(p.x, p.z), float(4), float(1.6)).mul(glassUniforms.rain.mul(0.6).add(glassUniforms.storm.mul(0.8)));
  mat.normalNode = transformNormalToView(normalize(vec3(rip.x, 1, rip.y)));
  return mat;
}

/** Painted steel / wall panel with low-frequency grime. */
export function createPaintedMaterial(color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0.15, grime = 0.25): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness });
  const c = new THREE.Color(color);
  const p = positionWorld;
  const nz = mx_fractal_noise_float(p.mul(1.3), 3, 2, 0.5).mul(0.5).add(0.5);
  const streak = mx_noise_float(vec3(p.x.mul(6), p.y.mul(0.4), p.z.mul(6))).mul(0.5).add(0.5);
  mat.colorNode = vec3(c.r, c.g, c.b).mul(float(1).sub(nz.mul(grime)).sub(streak.mul(grime * 0.3)));
  mat.roughnessNode = float(roughness).add(nz.mul(0.15)).sub(streak.mul(0.08));
  return mat;
}

/** Brushed/worn metal. */
export function createMetalMaterial(color: THREE.ColorRepresentation, roughness = 0.4): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ metalness: 0.85 });
  const c = new THREE.Color(color);
  const p = positionWorld;
  const brushed = mx_noise_float(vec3(p.x.mul(40), p.y.mul(1.5), p.z.mul(40))).mul(0.5).add(0.5);
  const wear = mx_fractal_noise_float(p.mul(3), 2, 2, 0.5).mul(0.5).add(0.5);
  mat.colorNode = vec3(c.r, c.g, c.b).mul(brushed.mul(0.15).add(0.85));
  mat.roughnessNode = float(roughness).add(brushed.mul(0.1)).sub(wear.mul(0.12));
  return mat;
}

/** Emissive material whose emission also feeds the bloom MRT at a controlled ratio. */
export function createEmissiveMaterial(color: THREE.ColorRepresentation, intensity: N | number, bloomRatio = 0.6): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial();
  const c = new THREE.Color(color);
  const k = typeof intensity === "number" ? float(intensity) : intensity;
  const col = vec3(c.r, c.g, c.b).mul(k);
  mat.colorNode = col;
  mat.mrtNode = mrt({ emissive: vec4(col.mul(bloomRatio), 1) });
  return mat;
}
