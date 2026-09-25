import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  floor,
  fract,
  hash,
  mix,
  mrt,
  output,
  emissive,
  pass,
  renderOutput,
  screenUV,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
  dot,
  luminance,
  max,
  sin,
  step,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import type { QualityProfile } from "../performance/Quality";
import { asV3, type N } from "./materials/tslUtils";

export interface Grade {
  exposure: number;
  lift: THREE.Color;
  gain: THREE.Color;
  saturation: number;
  bloom: number;
  vignette: number;
}

/**
 * Post stack (single RenderPipeline):
 *   scene pass (MRT: output + emissive)
 *   → bloom from emissive only (controlled glow)
 *   → glitch row-shift + edge chromatic aberration
 *   → exposure → ACES + sRGB (renderOutput)
 *   → grade (lift/gain/saturation) → vignette → grain → fade
 *   → optional FXAA (high)
 */
export class PostFX {
  readonly pipeline: THREE.RenderPipeline;
  private scenePass: ReturnType<typeof pass>;
  private bloomPass: ReturnType<typeof bloom>;

  readonly u = {
    exposure: uniform(1),
    lift: uniform(new THREE.Color(0, 0, 0)),
    gain: uniform(new THREE.Color(1, 1, 1)),
    saturation: uniform(1),
    bloom: uniform(0.8),
    vignette: uniform(0.35),
    fade: uniform(1),
    fadeColor: uniform(new THREE.Color(0.012, 0.016, 0.02)),
    glitch: uniform(0),
    aberration: uniform(0.0015),
    grain: uniform(0.045),
    warp: uniform(0),
  };

  private profile: QualityProfile;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, profile: QualityProfile) {
    this.profile = profile;
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;

    this.scenePass = pass(scene, camera);
    const mrtNode = mrt({ output, emissive: vec4(emissive, output.a) });
    mrtNode.setBlendMode("emissive", new THREE.BlendMode(THREE.NormalBlending));
    this.scenePass.setMRT(mrtNode);
    this.scenePass.getTexture("emissive").type = THREE.HalfFloatType;

    const emissiveTex = this.scenePass.getTextureNode("emissive");
    this.bloomPass = bloom(emissiveTex, 1, 0.55, 0);
    this.bloomPass.setResolutionScale(profile.bloomResolution);

    this.build();
  }

  getScene(): THREE.Scene {
    return this.scenePass.scene as THREE.Scene;
  }

  setScene(scene: THREE.Scene): void {
    this.scenePass.scene = scene;
  }

  setProfile(profile: QualityProfile): void {
    this.profile = profile;
    this.bloomPass.setResolutionScale(profile.bloomResolution);
    this.build();
  }

  private build(): void {
    const u = this.u;
    const colorTex = this.scenePass.getTextureNode("output");
    const useBloom = this.profile.bloom;
    const bloomTex = this.bloomPass;

    const composite = Fn(() => {
      const uv0 = screenUV.toVar();

      // --- glitch: horizontal row tearing + block offsets (memory corruption)
      const g = u.glitch;
      const rowId = floor(uv0.y.mul(float(38).add(floor(time.mul(7)).mod(3).mul(17))));
      const rnd = hash(rowId.add(floor(time.mul(13)).mul(31.7)));
      const tear = step(float(1).sub(g.mul(0.35)), rnd).mul(rnd.sub(0.5)).mul(g).mul(0.08);
      const blockRnd = hash(floor(uv0.mul(vec2(9, 16))).dot(vec2(1, 57)).add(floor(time.mul(5))));
      const block = step(float(1).sub(g.mul(0.08)), blockRnd).mul(0.03).mul(g);
      // --- gentle heat-haze warp (memory room)
      const warp = vec2(sin(uv0.y.mul(24).add(time.mul(1.3))), sin(uv0.x.mul(19).sub(time.mul(1.1)))).mul(u.warp).mul(0.0025);
      const uv = uv0.add(vec2(tear.add(block), 0)).add(warp);

      // --- edge chromatic aberration (stronger when glitching)
      const centered = uv.sub(0.5);
      const edge = dot(centered, centered);
      const ca = centered.mul(edge.mul(u.aberration).mul(4).add(g.mul(0.006)));
      const r = colorTex.sample(uv.add(ca)).r;
      const gC = colorTex.sample(uv).g;
      const b = colorTex.sample(uv.sub(ca)).b;
      let col: N = vec3(r, gC, b);
      if (useBloom) col = col.add((bloomTex as unknown as { getTextureNode(): N }).getTextureNode().sample(uv).rgb.mul(u.bloom));
      col = col.mul(u.exposure);

      // --- tone map + sRGB
      const mapped = renderOutput(vec4(col, 1)).rgb.toVar();

      // --- grade in display space
      const graded = mapped.mul(asV3(u.gain)).add(asV3(u.lift).mul(float(1).sub(mapped)));
      const l = luminance(graded);
      const sat = mix(vec3(l), graded, u.saturation);

      // --- vignette (elliptical, soft)
      const vUv = screenUV.sub(0.5).mul(vec2(1.0, 1.15));
      const vig = smoothstep(float(0.85), float(0.2), vUv.length()).mul(u.vignette).add(float(1).sub(u.vignette));
      let outCol = sat.mul(vig);

      // --- film grain, luminance-weighted so blacks stay clean
      const n = fract(sin(dot(screenUV.add(fract(time.mul(0.137))), vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
      const grainAmt = u.grain.mul(float(1).sub(l.mul(0.6)));
      outCol = outCol.add(n.mul(grainAmt));

      // --- scanline hint while glitching
      const scan = sin(screenUV.y.mul(900)).mul(0.5).add(0.5).mul(g).mul(0.06);
      outCol = outCol.sub(scan);

      outCol = mix(outCol, asV3(u.fadeColor), u.fade);
      return vec4(max(outCol, vec3(0)), 1);
    })();

    this.pipeline.outputNode = this.profile.smaa ? fxaa(composite) : composite;
    this.pipeline.needsUpdate = true;
  }

  applyGrade(g: Partial<Grade>): void {
    const u = this.u;
    if (g.exposure !== undefined) u.exposure.value = g.exposure;
    if (g.lift) (u.lift.value as THREE.Color).copy(g.lift);
    if (g.gain) (u.gain.value as THREE.Color).copy(g.gain);
    if (g.saturation !== undefined) u.saturation.value = g.saturation;
    if (g.bloom !== undefined) u.bloom.value = g.bloom;
    if (g.vignette !== undefined) u.vignette.value = g.vignette;
  }

  render(): void {
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
  }
}
