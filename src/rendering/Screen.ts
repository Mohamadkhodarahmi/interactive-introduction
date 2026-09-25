import * as THREE from "three/webgpu";
import { Fn, float, mix, mrt, screenUV, sin, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4, length, hash, floor } from "three/tsl";

export type ScreenPainter = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/**
 * A display surface backed by a 2D canvas. Content is repainted at a capped rate;
 * the material adds scanlines, a soft vignette, power-on/off behaviour and a
 * controlled contribution to bloom.
 */
export class Screen {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicNodeMaterial;
  readonly power = uniform(0);
  readonly brightness = uniform(1);
  /** 0..1 interference noise. */
  readonly noise = uniform(0);
  painter: ScreenPainter | null = null;
  fps = 20;
  private acc = 0;
  private time = 0;

  constructor(
    readonly width = 512,
    readonly height = 288,
    tint: THREE.ColorRepresentation = 0xffffff,
    bloomRatio = 0.35,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, width, height);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;

    const c = new THREE.Color(tint);
    const mat = new THREE.MeshBasicNodeMaterial();
    const col = Fn(() => {
      const p = uv();
      const img = texture(this.texture, p).rgb;
      // Scanlines + slow roll bar.
      const scan = sin(p.y.mul(height * 3.14159)).mul(0.06).add(0.94);
      const roll = smoothstep(float(0.0), float(0.08), sin(p.y.mul(3).sub(time.mul(0.7))).mul(0.5).add(0.5)).mul(0.05).add(0.95);
      // Vignette toward bezel.
      const d = length(p.sub(0.5).mul(vec2(1.0, 1.2)));
      const vig = smoothstep(float(0.85), float(0.35), d);
      const n = hash(floor(p.mul(vec2(width / 2, height / 2))).dot(vec2(1, 173)).add(floor(time.mul(24)).mul(7.1)));
      const noisy = mix(img, vec3(n.mul(0.1), n.mul(0.12), n.mul(0.15)), this.noise);
      const glass = vec3(0.004, 0.005, 0.006);
      const lit = noisy.mul(vec3(c.r, c.g, c.b)).mul(scan).mul(roll).mul(vig.mul(0.35).add(0.65)).mul(this.brightness);
      return mix(glass, lit.mul(1.4), this.power);
    })();
    mat.colorNode = col;
    mat.mrtNode = mrt({ emissive: vec4(col.mul(bloomRatio), 1) });
    void screenUV;
    this.material = mat;
  }

  /** Repaint if enough time has passed. Returns true when repainted. */
  update(dt: number, force = false): boolean {
    this.time += dt;
    this.acc += dt;
    if (!this.painter) return false;
    if (!force && this.acc < 1 / this.fps) return false;
    this.acc = 0;
    this.painter(this.ctx, this.width, this.height, this.time);
    this.texture.needsUpdate = true;
    return true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------- drawing helpers

export const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const FA = '"Vazirmatn", system-ui, sans-serif';

export function clear(ctx: CanvasRenderingContext2D, w: number, h: number, color = "#05080a"): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, opts: { align?: CanvasTextAlign; font?: string; weight?: number; spacing?: number; alpha?: number } = {}): void {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.fillStyle = color;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.font = `${opts.weight ?? 400} ${size}px ${opts.font ?? MONO}`;
  if (opts.spacing && "letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${opts.spacing}px`;
  ctx.fillText(s, x, y);
  ctx.restore();
}
