import * as THREE from "three/webgpu";
import gsap from "gsap";
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
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  length,
  color,
  densityFogFactor,
  fog,
  abs,
  mx_noise_float,
  step,
  normalize,
  transformNormalToView,
} from "three/tsl";
import { BaseScene } from "../../core/BaseScene";
import type { AppContext } from "../../core/AppContext";
import type { CameraPose } from "../../camera/CameraManager";
import { wait } from "../../core/Timeline";
import { Batch } from "../../rendering/geo";
import { createMetalMaterial, createPaintedMaterial, ripples } from "../../rendering/materials/surfaces";
import { Screen, clear, text } from "../../rendering/Screen";
import type { SignalChoice } from "../../state/ExperienceState";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Fragment {
  id: number;
  group: THREE.Group;
  shard: THREE.Mesh;
  screen: Screen;
  home: THREE.Vector3;
  restored: boolean;
  glow: { value: number };
  anchor: THREE.Vector3;
  label: string;
}

/**
 * Scene 3 — the memory room. A flooded, derelict archive where gravity no longer
 * works: furniture, papers and rain hang in the air, broken holographic
 * wireframes of the observation room flicker, and three memory fragments float
 * waiting to be put back. The third fragment replays whatever the user chose
 * earlier (storm / reconstructed signal / signal at the glass).
 */
export class MemoryScene extends BaseScene {
  readonly id = "memory";
  poses: Record<string, CameraPose> = {
    memoryRoom: {
      position: V(0, 1.7, 6.2),
      target: V(0, 1.9, 0),
      fov: 55,
      sway: 0.02,
      look: { yaw: 0.45, pitch: 0.2 },
      portrait: { position: V(0, 1.7, 7.4), target: V(0, 1.9, 0), fov: 55 },
    },
    memoryEntry: {
      position: V(0, 2.4, 11),
      target: V(0, 1.6, 0),
      fov: 60,
      sway: 0.03,
    },
    memoryCore: {
      position: V(0, 1.85, 3.4),
      target: V(0, 2.0, 0),
      fov: 50,
      sway: 0.012,
      portrait: { position: V(0, 1.85, 4.4), target: V(0, 2.0, 0), fov: 52 },
    },
  };

  private u = {
    /** 0 = corrupted, 1 = restored. Drives colour, gravity, distortion. */
    restore: uniform(0),
    hologram: uniform(1),
  };
  private floating: { obj: THREE.Object3D; base: THREE.Vector3; rot: THREE.Vector3; phase: number; amp: number }[] = [];
  private fragments: Fragment[] = [];
  private core!: Screen;
  private coreMesh!: THREE.Mesh;
  private dust!: THREE.Sprite;
  private lights!: { key: THREE.PointLight; fill: THREE.HemisphereLight; core: THREE.PointLight };
  private restoredCount = 0;
  private coreMode: "idle" | "replay" | "done" = "idle";
  private coreSince = 0;
  private choice: SignalChoice = "investigate";

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected async build(): Promise<void> {
    const scene = this.scene;
    const { quality, renderer } = this.ctx;
    scene.background = new THREE.Color(0x020303);
    const fogDensity = uniform(0.04);
    scene.fogNode = fog(color(0x06080a), densityFogFactor(fogDensity));
    this.onDispose(() => void fogDensity);

    const b = new Batch();
    const concrete = createPaintedMaterial(0x2b2d2f, 0.9, 0.0, 0.45);
    const darkMetal = createMetalMaterial(0x3a3d41, 0.5);
    const rust = createPaintedMaterial(0x3b2f27, 0.85, 0.3, 0.5);

    // --- flooded floor: thin water sheet over concrete, still but rippling where drops fall.
    const water = new THREE.MeshStandardNodeMaterial({ metalness: 0.0, roughness: 0.04 });
    water.colorNode = vec3(0.01, 0.012, 0.014);
    const rp = ripples(vec2(positionWorld.x, positionWorld.z), float(1.4), float(0.35));
    water.normalNode = transformNormalToView(normalize(vec3(rp.x.mul(0.8), 1, rp.y.mul(0.8))));
    const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(16, 48), water);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    // --- archive chamber: ring of concrete piers + broken shelving, open to darkness above.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = 9.5;
      const h = 5 + ((i * 37) % 5);
      b.box(0.8, h, 0.8, concrete, [Math.cos(a) * r, h / 2 - 0.2, Math.sin(a) * r], [0, -a, 0]);
      if (i % 2 === 0) {
        // shelving between piers
        for (let s = 0; s < 4; s++) b.box(2.8, 0.05, 0.5, darkMetal, [Math.cos(a + 0.22) * (r - 0.3), 0.5 + s * 0.6, Math.sin(a + 0.22) * (r - 0.3)], [0, -a - 0.22 + Math.PI / 2, 0]);
      }
    }
    // Ceiling beams, partly collapsed
    for (let i = 0; i < 5; i++) b.box(20, 0.4, 0.4, rust, [0, 6.2 + (i % 2) * 0.3, -8 + i * 4], [0, 0, (i - 2) * 0.03]);
    b.box(7, 0.35, 0.35, rust, [3, 3.6, -2], [0.2, 0.3, 0.55]);
    b.build(scene);

    // --- floating objects (gravity anomaly)
    const fb = new THREE.Group();
    scene.add(fb);
    const chairMat = new THREE.MeshStandardNodeMaterial({ color: 0x0b0c0d, roughness: 0.7 });
    const paperMat = new THREE.MeshStandardNodeMaterial({ color: 0x8e8b84, roughness: 0.9, side: THREE.DoubleSide });
    const add = (obj: THREE.Object3D, pos: THREE.Vector3, amp = 0.15) => {
      obj.position.copy(pos);
      obj.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      fb.add(obj);
      this.floating.push({ obj, base: pos.clone(), rot: V((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2), phase: Math.random() * 10, amp });
    };
    // Chair (like the one upstairs)
    {
      const c = new THREE.Group();
      const cb = new Batch();
      cb.rbox(0.5, 0.08, 0.48, 0.03, chairMat, [0, 0.47, 0]);
      cb.rbox(0.46, 0.5, 0.07, 0.03, chairMat, [0, 0.95, 0.26], [-0.12, 0, 0]);
      cb.cyl(0.025, 0.025, 0.4, darkMetal, [0, 0.25, 0]);
      cb.build(c);
      add(c, V(-2.6, 2.3, -1.5), 0.25);
    }
    // Monitors (dead) and a keyboard
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.48, 0.05), darkMetal);
      add(m, V(2.4 + i * 0.7, 1.3 + i * 0.9, -2 - i * 1.1), 0.2);
    }
    for (let i = 0; i < 28; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), paperMat);
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 6;
      add(p, V(Math.cos(a) * r, 0.6 + Math.random() * 4, Math.sin(a) * r - 1), 0.3);
    }
    // Glass shards from the observation window
    const glassMat = new THREE.MeshStandardNodeMaterial({ color: 0x9fb4c8, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.35 });
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.1 + Math.random() * 0.25), glassMat);
      s.scale.set(1, 0.08, 1.6);
      add(s, V((Math.random() - 0.5) * 8, 1 + Math.random() * 3.5, (Math.random() - 0.5) * 6 - 1), 0.2);
    }

    // --- broken holographic outline of the observation room (the thing that was lost)
    {
      const room = new THREE.BoxGeometry(12, 3.6, 9, 6, 2, 4);
      const edges = new THREE.EdgesGeometry(room);
      const holo = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const h = this.u.hologram;
      const flick = step(0.25, fract(sin(time.mul(7.3)).mul(43.7)).add(0.5)).mul(0.5).add(0.5);
      const band = smoothstep(float(0.0), float(0.2), fract(positionWorld.y.mul(0.8).sub(time.mul(0.3))));
      const gaps = step(0.35, mx_noise_float(positionWorld.mul(0.9).add(time.mul(0.05))).mul(0.5).add(0.5));
      holo.colorNode = vec3(0.45, 0.75, 0.9).mul(h).mul(flick).mul(band.mul(0.6).add(0.4)).mul(gaps).mul(0.8);
      holo.opacityNode = h.mul(gaps).mul(0.8);
      const lines = new THREE.LineSegments(edges, holo);
      lines.position.set(0, 2.2, -1.5);
      lines.rotation.set(0.08, 0.3, -0.05);
      lines.scale.setScalar(0.55);
      scene.add(lines);
      room.dispose();
    }

    // --- suspended screens with fragments of earlier events
    const screenDefs = [
      { pos: V(-3.3, 2.6, -0.6), ry: 0.6, text: "POWER RESTORED" },
      { pos: V(3.4, 2.9, -0.2), ry: -0.55, text: "SIGNAL DETECTED" },
      { pos: V(-1.6, 3.9, -3.2), ry: 0.25, text: "USER — UNKNOWN" },
    ];
    const choiceLabel: Record<SignalChoice, string> = {
      approach: "EXTERIOR EXPOSURE",
      investigate: "DECODE H·E·L·L·_",
      ignore: "SIGNAL LOST · FOUND",
    };
    screenDefs.forEach((d, i) => {
      const sc = new Screen(320, 180, 0xcfe8ff, 0.3);
      sc.power.value = 0.8;
      sc.noise.value = 0.5;
      sc.painter = (ctx, w, h, t) => {
        const label = i === 2 ? choiceLabel[this.choice] : d.text;
        clear(ctx, w, h, "#05080a");
        text(ctx, label, w / 2, h / 2, 16, "#9fc3d6", { align: "center", spacing: 3, alpha: 0.6 + 0.4 * Math.sin(t * 5 + w) });
        text(ctx, "RECOVERED FRAGMENT", w / 2, h - 26, 10, "#4b6070", { align: "center", spacing: 2 });
      };
      sc.fps = 8;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), sc.material);
      m.position.copy(d.pos);
      m.rotation.y = d.ry;
      scene.add(m);
      this.floating.push({ obj: m, base: d.pos.clone(), rot: V(0, 0, 0), phase: Math.random() * 10, amp: 0.08 });
      this.onDispose(() => sc.dispose());
      (m.userData as { screen: Screen }).screen = sc;
    });

    // --- central memory core: a large suspended display that assembles as fragments return
    this.core = new Screen(768, 432, 0xeaf6ff, 0.3);
    this.core.fps = 24;
    this.core.power.value = 0.6;
    this.core.noise.value = 0.8;
    this.core.painter = (ctx, w, h, t) => this.paintCore(ctx, w, h, t);
    this.coreMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.35), this.core.material);
    this.coreMesh.position.set(0, 2.05, 0);
    scene.add(this.coreMesh);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.45, 0.06), darkMetal);
    frame.position.set(0, 2.05, -0.04);
    scene.add(frame);
    this.onDispose(() => this.core.dispose());

    // --- three memory fragments: crystalline shards with a small holographic image inside
    const labels = ["POWER", "SIGNAL", "?"];
    const homes = [V(-2.2, 1.35, 1.6), V(2.3, 1.6, 1.3), V(0.2, 3.35, 1.0)];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const glow = uniform(0.6);
      const shardMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.2, transparent: true });
      const edge = Fn(() => {
        const n = abs(sin(positionWorld.y.mul(14).add(time.mul(2))));
        return vec3(0.55, 0.8, 1.0).mul(glow).mul(n.mul(0.4).add(0.6));
      })();
      shardMat.colorNode = vec3(0.1, 0.14, 0.18);
      shardMat.emissiveNode = edge.mul(0.8);
      shardMat.opacity = 0.85;
      shardMat.mrtNode = mrt({ emissive: vec4(edge.mul(0.5), 1) });
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), shardMat);
      shard.scale.set(0.8, 1.5, 0.8);
      g.add(shard);
      const sc = new Screen(256, 144, 0xeaf6ff, 0.4);
      sc.power.value = 0.9;
      sc.noise.value = 0.35;
      sc.fps = 12;
      const idx = i;
      sc.painter = (ctx, w, h, t) => this.paintFragment(idx, ctx, w, h, t);
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), sc.material);
      card.position.set(0, 0.45, 0);
      g.add(card);
      // invisible, generous hit volume for touch
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicNodeMaterial({ visible: false }));
      g.add(hit);
      g.position.copy(homes[i]);
      scene.add(g);
      const frag: Fragment = { id: i, group: g, shard, screen: sc, home: homes[i].clone(), restored: false, glow, anchor: homes[i].clone(), label: labels[i] };
      this.fragments.push(frag);
      this.onDispose(() => sc.dispose());
    }

    // --- suspended rain: drops hang in the air, drifting upward (reversed gravity)
    {
      const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const h1 = hash(instanceIndex);
      const h2 = hash(instanceIndex.add(911));
      const h3 = hash(instanceIndex.add(1733));
      const r = this.u.restore;
      // corrupted: drift up slowly; restored: fall normally.
      const up = fract(h2.add(time.mul(0.02).mul(h3.add(0.5))));
      const down = fract(h2.sub(time.mul(0.9).mul(h3.add(0.6))));
      const yk = mix(up, down, r);
      const pos = vec3(h1.sub(0.5).mul(18), yk.mul(7), h3.sub(0.5).mul(16).sub(1));
      mat.positionNode = pos;
      const len = mix(float(0.03), float(0.25), r);
      mat.scaleNode = vec2(0.012, len);
      mat.colorNode = Fn(() => {
        const d = length(uv().sub(0.5).mul(vec2(2, 2)));
        const a = smoothstep(float(1), float(0.2), d).mul(0.5);
        return vec4(vec3(0.6, 0.75, 0.9).mul(a), a);
      })();
      this.dust = new THREE.Sprite(mat);
      this.dust.count = quality.memoryParticles;
      this.dust.frustumCulled = false;
      scene.add(this.dust);
    }

    // --- light: cold key from above, fill, core glow
    const key = new THREE.PointLight(0x9fc4e0, 140, 22, 1.7);
    key.position.set(1.5, 6, 2);
    key.castShadow = quality.shadows;
    if (key.castShadow) {
      key.shadow.mapSize.set(quality.shadowMapSize / 2, quality.shadowMapSize / 2);
      key.shadow.bias = -0.001;
    }
    const fill = new THREE.HemisphereLight(0x2a3a4c, 0x080808, 0.9);
    const coreLight = new THREE.PointLight(0xbfe0ff, 3, 8, 1.8);
    coreLight.position.set(0, 2.1, 0.8);
    scene.add(key, fill, coreLight);
    this.lights = { key, fill, core: coreLight };

    // Environment: dim cold studio.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0a0e12);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.8, 1.0).multiplyScalar(2) }));
    panel.position.set(0, 5, 0);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
    scene.environment = pmrem.fromScene(envScene, 0.05).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
    (panel.material as THREE.Material).dispose();
    panel.geometry.dispose();

    await renderer.compileAsync(scene, this.ctx.cameras.camera).catch(() => undefined);
  }

  enter(): void {
    super.enter();
    const { cameras, post, audio, store } = this.ctx;
    cameras.register(this.poses);
    post.setScene(this.scene);
    cameras.set("memoryEntry");
    this.choice = store.get().signalChoice ?? "investigate";
    this.u.restore.value = 0;
    this.u.hologram.value = 1;
    this.restoredCount = 0;
    this.coreMode = "idle";
    this.fragments.forEach((f) => {
      f.restored = false;
      f.glow.value = 0.6;
      f.group.position.copy(f.home);
      f.group.scale.setScalar(1);
      f.screen.noise.value = 0.35;
    });
    post.u.warp.value = 1;
    post.u.glitch.value = 0.12;
    post.applyGrade({ saturation: 0.55, exposure: 1.0, bloom: 1.0, vignette: 0.55 });
    (post.u.lift.value as THREE.Color).setRGB(0.0, 0.006, 0.012);
    (post.u.gain.value as THREE.Color).setRGB(0.9, 0.98, 1.08);
    audio.setMuffle(0.6, 2);
    audio.setRain(0.25, 0, 3);
    audio.setHum(0, 2);
    audio.setCity(0, 2);
    audio.setPad("memory", 0.5, 4);
  }

  /** The interactive part. Resolves when all three fragments are back. */
  async play(signal: AbortSignal): Promise<void> {
    const { cameras, ui, interactor, audio, store } = this.ctx;
    await cameras.goTo("memoryRoom", { duration: 5, ease: "power2.out" });
    ui.systemHead("MEMORY / SECTOR 7", true);
    await ui.system("FRAGMENTS RECOVERABLE  0 / 3", "warn");
    await ui.say("این‌ها تیکه‌هایی از چیزاییه که با هم دیدیم.");

    let hintTimer = 0;
    const scheduleHint = () => {
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => {
        const next = this.fragments.find((f) => !f.restored);
        if (next) ui.hint(next.group.position);
      }, 7000);
    };

    // Taps are handled immediately (several fragments can be in flight at once);
    // tapping an already-restored fragment counts as a revisit.
    await new Promise<void>((resolve, reject) => {
      let done = 0;
      signal.addEventListener("abort", () => {
        clearTimeout(hintTimer);
        reject(new Error("aborted"));
      }, { once: true });
      interactor.clear();
      this.fragments.forEach((f) => {
        interactor.add({
          id: `frag${f.id}`,
          objects: [f.group],
          enabled: true,
          onTap: () => {
            if (f.restored) {
              store.metrics.revisits++;
              audio.fragment(f.id);
              return;
            }
            ui.hint(null);
            interactor.setEnabled(`frag${f.id}`, false);
            this.restoreFragment(f, signal).then(() => {
              done++;
              if (done === 1) ui.say("یکی دیگه...").catch(() => undefined);
              if (done === 3) resolve();
              else scheduleHint();
            });
          },
        });
      });
      scheduleHint();
    });
    clearTimeout(hintTimer);
    ui.hint(null);
    interactor.clear();
    await wait(600, signal);

    // Final replay on the core display — depends on the earlier choice.
    this.coreMode = "replay";
    this.coreSince = 0;
    await cameras.goTo("memoryCore", { duration: 3.2 });
    const line =
      this.choice === "approach"
        ? "طوفان... یادمه چقدر نزدیک شدیم."
        : this.choice === "investigate"
          ? "سیگنال... داشت یه کلمه رو تکرار می‌کرد."
          : "اون نور... وقتی نادیده‌ش گرفتیم، خودش اومد جلو.";
    await ui.say(line, { hold: 800 });
    await wait(1200, signal);

    // Stabilise: gravity returns, colour comes back, distortion clears.
    audio.confirm();
    audio.whoosh(2);
    this.coreMode = "done";
    gsap.to(this.u.restore, { value: 1, duration: 3, ease: "power2.inOut" });
    gsap.to(this.u.hologram, { value: 0, duration: 2 });
    gsap.to(this.ctx.post.u.warp, { value: 0, duration: 2.5 });
    gsap.to(this.ctx.post.u.glitch, { value: 0, duration: 1.5 });
    gsap.to(this.ctx.post.u.saturation, { value: 0.85, duration: 3 });
    this.core.noise.value = 0;
    await ui.system("MEMORY RESTORED", "ok");
    await wait(2600, signal);
  }

  private async restoreFragment(f: Fragment, signal: AbortSignal): Promise<void> {
    const { audio, ui, cameras } = this.ctx;
    f.restored = true;
    this.restoredCount++;
    audio.fragment(f.id);
    cameras.shake(0.006, 0.4);
    gsap.to(f.glow, { value: 2.2, duration: 0.3, yoyo: true, repeat: 1 });
    f.screen.noise.value = 0;
    // Fly into the core and dissolve.
    await new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .to(f.group.position, { x: this.coreMesh.position.x, y: this.coreMesh.position.y, z: this.coreMesh.position.z + 0.1, duration: 1.4, ease: "power3.inOut" })
        .to(f.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.5, ease: "power2.in" }, 1.0);
    });
    this.core.noise.value = Math.max(0, 0.8 - this.restoredCount * 0.27);
    this.core.power.value = 0.6 + this.restoredCount * 0.13;
    this.lights.core.intensity = 3 + this.restoredCount * 2;
    this.ctx.post.u.glitch.value = Math.max(0, 0.12 - this.restoredCount * 0.04);
    await ui.system(`FRAGMENTS RECOVERABLE  ${this.restoredCount} / 3`, this.restoredCount === 3 ? "ok" : "warn");
    void signal;
  }

  // ---------------------------------------------------------------- painters

  private paintFragment(i: number, ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    clear(ctx, w, h, "#04070a");
    if (i === 0) {
      // Lights coming on.
      for (let k = 0; k < 6; k++) {
        const on = Math.sin(t * 3 + k) > -0.2;
        ctx.fillStyle = on ? "rgba(255,226,192,0.85)" : "rgba(255,226,192,0.08)";
        ctx.fillRect(20 + k * 38, 30, 28, 8);
      }
      text(ctx, "POWER", w / 2, h - 34, 16, "#86c7b9", { align: "center", spacing: 4 });
    } else if (i === 1) {
      const g = Math.sin(t * 6) > 0 ? 1 : 0.2;
      ctx.fillStyle = `rgba(191,233,255,${g})`;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2 - 10, 10, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, "SIGNAL", w / 2, h - 30, 16, "#bfe9ff", { align: "center", spacing: 4 });
    } else {
      text(ctx, "? ? ?", w / 2, h / 2 - 6, 26, "#d9a441", { align: "center", spacing: 8, alpha: 0.5 + 0.5 * Math.sin(t * 4) });
      text(ctx, "UNSORTED", w / 2, h - 30, 12, "#6b7a86", { align: "center", spacing: 3 });
    }
  }

  private paintCore(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    clear(ctx, w, h, "#030507");
    const c = this.choice;
    const k = this.restoredCount;
    text(ctx, "MEMORY CORE", 28, 30, 14, "#6b7a86", { spacing: 4 });
    text(ctx, `${k} / 3`, w - 28, 30, 14, k === 3 ? "#86c7b9" : "#d9a441", { align: "right", spacing: 4 });
    if (this.coreMode === "idle") {
      for (let i = 0; i < 3; i++) {
        const x = w / 2 + (i - 1) * 180;
        ctx.strokeStyle = i < k ? "rgba(134,199,185,0.8)" : "rgba(200,214,224,0.15)";
        ctx.strokeRect(x - 70, h / 2 - 60, 140, 120);
        text(ctx, i < k ? ["POWER", "SIGNAL", "EVENT"][i] : "—", x, h / 2, 14, i < k ? "#c8d6e0" : "#3d4b57", { align: "center", spacing: 3 });
      }
      return;
    }
    // Replay of the branch the user took.
    this.coreSince += 1 / 24;
    const s = this.coreSince;
    if (c === "approach") {
      // Exterior storm: slanted rain, lightning.
      const flash = Math.sin(s * 1.7) > 0.96 ? 1 : 0;
      ctx.fillStyle = flash ? "#9fb0c8" : "#060a10";
      ctx.fillRect(0, 50, w, h - 90);
      ctx.strokeStyle = "rgba(180,200,220,0.35)";
      for (let i = 0; i < 90; i++) {
        const x = (i * 97 + s * 400) % (w + 100) - 50;
        const y = 50 + ((i * 53 + s * 700) % (h - 90));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 8, y + 26);
        ctx.stroke();
      }
      for (let i = 0; i < 14; i++) {
        const bh = 60 + ((i * 71) % 140);
        ctx.fillStyle = "#0b1018";
        ctx.fillRect(i * 58, h - 40 - bh, 50, bh);
      }
      ctx.fillStyle = "#e8f6ff";
      ctx.beginPath();
      ctx.arc(w * 0.62, h * 0.42, 5 + Math.sin(s * 8) * 2, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, "EXTERIOR — STORM CELL 4.2 KM", 28, h - 20, 12, "#8aa0b4", { spacing: 2 });
    } else if (c === "investigate") {
      const letters = "HELLO";
      const shown = Math.min(5, Math.floor(s / 0.7));
      text(ctx, ".... . .-.. .-.. ---", w / 2, h / 2 - 60, 22, "#6f8fa3", { align: "center", spacing: 6 });
      for (let i = 0; i < 5; i++) {
        const x = w / 2 + (i - 2) * 86;
        ctx.strokeStyle = i < shown ? "rgba(191,233,255,0.6)" : "rgba(200,214,224,0.12)";
        ctx.strokeRect(x - 34, h / 2 - 20, 68, 84);
        text(ctx, i < shown ? letters[i] : "_", x, h / 2 + 22, 44, i < shown ? "#bfe9ff" : "#3d4b57", { align: "center", weight: 600 });
      }
      text(ctx, "RECONSTRUCTED SIGNAL — COMPLETE", 28, h - 20, 12, "#86c7b9", { spacing: 2 });
    } else {
      // The light right outside the glass.
      ctx.fillStyle = "#05080c";
      ctx.fillRect(0, 50, w, h - 90);
      ctx.strokeStyle = "rgba(200,214,224,0.3)";
      ctx.lineWidth = 6;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * (w / 4), 50);
        ctx.lineTo(i * (w / 4) + 30, h - 40);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      const pulse = Math.sin(s * 5) * 0.5 + 0.5;
      const g = ctx.createRadialGradient(w * 0.4, h * 0.45, 0, w * 0.4, h * 0.45, 90);
      g.addColorStop(0, `rgba(230,246,255,${0.6 + pulse * 0.4})`);
      g.addColorStop(1, "rgba(230,246,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 50, w, h - 90);
      text(ctx, "PROXIMITY — 12 M · IT CAME TO US", 28, h - 20, 12, "#d9a441", { spacing: 2 });
    }
  }

  update(dt: number, t: number): void {
    if (!this.active) return;
    const r = this.u.restore.value as number;
    // Floating objects: slow bob + tumble; settle as memory is restored.
    for (const f of this.floating) {
      const amp = f.amp * (1 - r * 0.8);
      f.obj.position.set(
        f.base.x + Math.sin(t * 0.3 + f.phase) * amp,
        f.base.y + Math.sin(t * 0.45 + f.phase * 1.3) * amp - r * 0.0,
        f.base.z + Math.cos(t * 0.27 + f.phase) * amp,
      );
      const spin = 1 - r;
      f.obj.rotation.x += f.rot.x * dt * spin;
      f.obj.rotation.y += f.rot.y * dt * spin;
      f.obj.rotation.z += f.rot.z * dt * spin;
      const sc = (f.obj.userData as { screen?: Screen }).screen;
      if (sc) {
        sc.noise.value = 0.5 * (1 - r);
        sc.update(dt);
      }
    }
    for (const f of this.fragments) {
      if (!f.restored) {
        f.group.position.y = f.home.y + Math.sin(t * 1.1 + f.id * 2) * 0.08;
        f.group.rotation.y += dt * 0.4;
        f.anchor.copy(f.group.position);
      }
      f.screen.update(dt);
    }
    this.core.update(dt);
    this.lights.key.intensity = 140 + Math.sin(t * 13) * (1 - r) * 15 + (Math.random() < 0.01 * (1 - r) ? -90 : 0);
  }
}
