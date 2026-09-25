import * as THREE from "three/webgpu";
import { Fn, float, length, max, mrt, smoothstep, uniform, uv, vec4, abs, exp, fract, time } from "three/tsl";
import { asV3 } from "../../rendering/materials/tslUtils";

/** "HELLO" in Morse. The signal has been saying it all along. */
export const MORSE_TEXT = "HELLO";
const MORSE: Record<string, string> = { H: "....", E: ".", L: ".-..", O: "---" };

/** Build an on/off timeline in Morse units: dot=1, dash=3, gaps 1/3/7. */
function buildPattern(text: string): { on: boolean; units: number }[] {
  const out: { on: boolean; units: number }[] = [];
  [...text].forEach((ch, ci) => {
    const code = MORSE[ch] ?? "";
    [...code].forEach((sym, si) => {
      out.push({ on: true, units: sym === "." ? 1 : 3 });
      if (si < code.length - 1) out.push({ on: false, units: 1 });
    });
    if (ci < text.length - 1) out.push({ on: false, units: 3 });
  });
  out.push({ on: false, units: 10 });
  return out;
}

export class MorseClock {
  private pattern = buildPattern(MORSE_TEXT);
  private total = this.pattern.reduce((a, p) => a + p.units, 0);
  unit = 0.16;

  /** 0/1 gate at time t (seconds). */
  gate(t: number): number {
    let u = (t / this.unit) % this.total;
    for (const p of this.pattern) {
      if (u < p.units) return p.on ? 1 : 0;
      u -= p.units;
    }
    return 0;
  }

  /** Index of the letter being transmitted at time t (or -1 in the long pause). */
  letterAt(t: number): number {
    const u = (t / this.unit) % this.total;
    let unitsSeen = 0;
    const letters = [...MORSE_TEXT];
    for (let li = 0; li < letters.length; li++) {
      const code = MORSE[letters[li]];
      const len = [...code].reduce((a, s) => a + (s === "." ? 1 : 3), 0) + (code.length - 1);
      if (u < unitsSeen + len + 3) return li;
      unitsSeen += len + 3;
    }
    return -1;
  }
}

/**
 * The signal: a small, very pure light with a soft halo, a faint horizontal
 * lens streak and expanding rings on each pulse. Sized in screen space so it
 * stays legible whether it's a kilometre away or right outside the glass.
 */
export class Signal {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  readonly u = {
    visible: uniform(0),
    gate: uniform(0),
    intensity: uniform(1),
    /** Apparent size in radians-ish (scaled by distance). */
    size: uniform(0.02),
    color: uniform(new THREE.Color(0.78, 0.93, 1.0)),
  };
  private sprite: THREE.Sprite;
  private morse = new MorseClock();
  gateValue = 0;
  private smoothGate = 0;

  constructor() {
    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.fog = false;
    const u = this.u;
    const col = Fn(() => {
      const p = uv().sub(0.5).mul(2);
      const r = length(p);
      const g = u.gate.mul(0.75).add(0.25);
      const core = exp(r.mul(r).mul(-900)).mul(6);
      const halo = exp(r.mul(-7)).mul(0.5).mul(g);
      const streak = exp(abs(p.y).mul(-160)).mul(exp(abs(p.x).mul(-3.5))).mul(0.6).mul(g);
      const ringT = fract(time.mul(0.62));
      const ring = smoothstep(float(0.03), float(0.0), abs(r.sub(ringT.mul(0.9)))).mul(float(1).sub(ringT)).mul(0.35).mul(u.gate);
      const a = core.mul(g).add(halo).add(streak).add(ring).mul(u.visible).mul(u.intensity);
      return vec4(asV3(u.color).mul(a), max(a, float(0)).clamp(0, 1));
    })();
    mat.colorNode = col;
    mat.mrtNode = mrt({ emissive: vec4(col.xyz.mul(0.5), 1) });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.renderOrder = 4;
    this.sprite.frustumCulled = false;
    this.group.add(this.sprite);
    this.light = new THREE.PointLight(0xc6ecff, 0, 14, 1.4);
    this.group.add(this.light);
  }

  setPosition(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  update(t: number, camera: THREE.Camera, lightScale = 0): void {
    this.gateValue = this.morse.gate(t);
    this.smoothGate += (this.gateValue - this.smoothGate) * 0.5;
    this.u.gate.value = this.smoothGate;
    const dist = camera.position.distanceTo(this.group.position);
    const s = Math.max(0.25, dist * (this.u.size.value as number));
    this.sprite.scale.set(s, s, 1);
    this.light.intensity = lightScale * (0.3 + this.smoothGate * 0.9) * (this.u.visible.value as number);
  }

  letterAt(t: number): number {
    return this.morse.letterAt(t);
  }
}
