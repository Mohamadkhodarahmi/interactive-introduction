import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  max,
  mix,
  mx_fractal_noise_float,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  dot,
  exp,
  clamp,
} from "three/tsl";
import { cityUniforms } from "./city";
import { asV3 } from "./tslUtils";

export const skyUniforms = {
  /** Direction of the current lightning strike (xz, normalised-ish). */
  flashDir: uniform(new THREE.Vector3(-0.4, 0.2, -1).normalize()),
  /** City light pollution under the cloud deck. */
  glow: uniform(0.55),
  /** Overall cloud coverage. */
  cover: uniform(0.62),
  horizon: uniform(new THREE.Color(0.05, 0.043, 0.048)),
};

/**
 * Night sky dome: deep zenith, low overcast deck lit from below by the city,
 * drifting fbm clouds and lightning that lights the deck locally.
 */
export function createSkyMaterial(octaves: number): THREE.MeshBasicNodeMaterial {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  mat.fog = false;

  mat.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const y = max(dir.y, float(0.0));
    const uvC = vec2(dir.x, dir.z).div(max(y, float(0.035))).mul(0.45);
    const drift = vec2(time.mul(0.004), time.mul(0.0015));
    const n = mx_fractal_noise_float(vec3(uvC.add(drift), time.mul(0.01)), octaves, 2.1, 0.55);
    const n2 = mx_fractal_noise_float(vec3(uvC.mul(2.3).sub(drift.mul(1.5)), 3.7), Math.max(1, octaves - 1), 2.0, 0.5);
    const cover = skyUniforms.cover;
    const density = smoothstep(float(0.05).sub(cover.mul(0.4)), float(0.55), n.add(n2.mul(0.35)));

    // Light pollution: brightest at horizon, falling off with elevation.
    const horizonGlow = exp(y.mul(-7)).mul(skyUniforms.glow);
    const zenith = vec3(0.0035, 0.0045, 0.0075);
    const sky = mix(asV3(skyUniforms.horizon), zenith, smoothstep(float(0.0), float(0.45), y));
    const underlit = vec3(0.13, 0.085, 0.07).mul(horizonGlow).add(vec3(0.012, 0.014, 0.02));
    const cloudCol = mix(underlit.mul(0.55), underlit.mul(1.15), n2.mul(0.5).add(0.5));
    let col = mix(sky, cloudCol, density.mul(smoothstep(float(0.0), float(0.08), y)));

    // Lightning: bright core near flashDir, soft illumination of the whole deck.
    const f = cityUniforms.flash;
    const toward = max(dot(dir, skyUniforms.flashDir), float(0));
    const local = pow(toward, float(6)).mul(3.5).add(0.35);
    col = col.add(vec3(0.55, 0.6, 0.8).mul(f).mul(local).mul(density.mul(0.8).add(0.2)));

    // Below the horizon blend into haze (matches fog colour).
    const below = smoothstep(float(0.0), float(-0.08), dir.y);
    col = mix(col, asV3(skyUniforms.horizon).mul(0.8), below);
    return clamp(col, 0, 4);
  })();
  return mat;
}
