import { Fn, dot, float, fract, sin, vec2, vec3 } from "three/tsl";
/* TSL node graphs are dynamically typed; `N` keeps Fn signatures readable
   without fighting the generated generics. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = any;

/** Treat a colour uniform as a vec3 node. */
export const asV3 = (u: unknown): N => u as N;

/** 2D → 1D hash in [0,1). */
export const hash21 = Fn(([p]: [N]) => {
  const q = vec2(p);
  return fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453123));
});

/** 2D → 2D hash in [0,1)^2. */
export const hash22 = Fn(([p]: [N]) => {
  const q = vec2(p);
  const a = dot(q, vec2(127.1, 311.7));
  const b = dot(q, vec2(269.5, 183.3));
  return fract(sin(vec2(a, b)).mul(43758.5453123));
});

/** 1D → 1D hash in [0,1). */
export const hash11 = Fn(([x]: [N]) => fract(sin(float(x).mul(12.9898)).mul(43758.5453)));

/** 1D → 3D hash in [0,1)^3. */
export const hash13 = Fn(([x]: [N]) => {
  const f = float(x);
  return fract(sin(vec3(f.mul(12.9898), f.mul(78.233), f.mul(37.719))).mul(43758.5453));
});

/** Seeded PRNG for deterministic procedural layout on the CPU side. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
