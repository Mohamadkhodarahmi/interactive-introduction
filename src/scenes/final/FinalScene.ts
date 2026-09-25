import * as THREE from "three/webgpu";
import gsap from "gsap";
import {
  Fn,
  float,
  floor,
  fract,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  color,
  densityFogFactor,
  fog,
  abs,
  length,
} from "three/tsl";
import { BaseScene } from "../../core/BaseScene";
import type { AppContext } from "../../core/AppContext";
import type { CameraPose } from "../../camera/CameraManager";
import { wait } from "../../core/Timeline";
import { Batch } from "../../rendering/geo";
import { createGlassMaterial, createMetalMaterial, createPaintedMaterial } from "../../rendering/materials/surfaces";
import { Screen, clear, text, MONO, FA } from "../../rendering/Screen";
import { buildCity } from "../observation/cityBuilder";
import { createRainMaterial } from "../../rendering/materials/rain";
import { hash21 } from "../../rendering/materials/tslUtils";
import { CREATOR } from "../../config";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

type LaptopState = "off" | "boot" | "reveal" | "hello";

/**
 * Scene 6 — the hidden room. Small, warm and lived-in: a desk under a rainy
 * window, a laptop, headphones, a notebook, coffee, a lamp. The laptop is where
 * the creator finally says hello.
 */
export class FinalScene extends BaseScene {
  readonly id = "final";
  poses: Record<string, CameraPose> = {
    finalStart: {
      position: V(0.2, 1.62, 2.6),
      target: V(-0.2, 1.35, -1),
      fov: 55,
      sway: 0.01,
    },
    finalRoom: {
      position: V(0.55, 1.45, 0.55),
      target: V(-0.05, 1.0, -1.25),
      fov: 50,
      sway: 0.008,
      look: { yaw: 0.45, pitch: 0.2 },
      portrait: { position: V(0.5, 1.5, 1.05), target: V(-0.05, 1.0, -1.25), fov: 52 },
    },
    laptop: {
      position: V(0.05, 1.22, -0.35),
      target: V(-0.05, 0.98, -1.28),
      fov: 44,
      sway: 0.004,
      look: { yaw: 0.35, pitch: 0.15 },
      portrait: { position: V(0.05, 1.25, -0.05), target: V(-0.05, 0.98, -1.28), fov: 46 },
    },
  };

  private laptop!: Screen;
  private laptopState: LaptopState = "off";
  private laptopSince = 0;
  private typed = 0;
  private revealSince = 0;
  private revealStart = 0;
  private lights!: { lamp: THREE.SpotLight; bounce: THREE.PointLight; window: THREE.DirectionalLight; screen: THREE.PointLight; ambient: THREE.HemisphereLight };
  private steam!: THREE.Mesh;
  private lid!: THREE.Object3D;
  private rain!: THREE.Sprite;
  private u = { steam: uniform(1) };

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected async build(): Promise<void> {
    const scene = this.scene;
    const { quality, renderer } = this.ctx;
    scene.background = new THREE.Color(0x020304);
    scene.fogNode = fog(color(0x0b0c10), densityFogFactor(uniform(0.00055)));

    // Same city outside, lighter build.
    const city = buildCity({ ...quality, buildingCount: Math.floor(quality.buildingCount * 0.6), trafficCount: Math.floor(quality.trafficCount * 0.5) }, { seed: 7 });
    // The room faces the other way round the tower: rotate the world outside.
    city.group.rotation.y = 0.6;
    scene.add(city.group);
    this.onDispose(() => void city);

    const b = new Batch();
    const W = 4.4;
    const D = 4.2;
    const H = 2.75;
    // Room spans x -W/2..W/2, z -1.8..D-1.8 ; window wall at z = -1.8
    const zBack = -1.8;
    const plaster = createPaintedMaterial(0x6d6258, 0.92, 0.0, 0.18);
    const plasterDark = createPaintedMaterial(0x3f3831, 0.9, 0.0, 0.15);
    const wood = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    wood.colorNode = Fn(() => {
      const p = positionWorld;
      const plank = floor(p.x.div(0.18));
      const r = hash21(vec2(plank, floor(p.z.div(1.2).add(plank.mul(0.37)))));
      const grain = mx_noise_float(vec3(p.x.mul(40), 0, p.z.mul(2.5))).mul(0.5).add(0.5);
      const base = mix(vec3(0.12, 0.07, 0.04), vec3(0.2, 0.12, 0.065), r);
      const seam = smoothstep(float(0.0), float(0.02), fract(p.x.div(0.18))).mul(smoothstep(float(1), float(0.98), fract(p.x.div(0.18))));
      return base.mul(grain.mul(0.35).add(0.75)).mul(seam.mul(0.4).add(0.6));
    })();
    wood.roughnessNode = Fn(() => mx_noise_float(positionWorld.mul(vec3(30, 1, 2))).mul(0.12).add(0.42))();
    const deskWood = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
    deskWood.colorNode = Fn(() => {
      const p = positionWorld;
      const grain = mx_fractal_noise_float(vec3(p.x.mul(3), p.y.mul(3), p.z.mul(60)), 2, 2, 0.5).mul(0.5).add(0.5);
      return mix(vec3(0.16, 0.1, 0.06), vec3(0.28, 0.18, 0.1), grain);
    })();
    deskWood.roughnessNode = float(0.5);
    const black = new THREE.MeshStandardNodeMaterial({ color: 0x0c0c0d, roughness: 0.55, metalness: 0.2 });
    const alu = createMetalMaterial(0x8e9196, 0.32);
    const fabric = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.95 });
    fabric.colorNode = Fn(() => {
      const p = positionWorld;
      const weave = sin(p.x.mul(300)).mul(sin(p.z.mul(300))).mul(0.04).add(1);
      return vec3(0.09, 0.1, 0.11).mul(weave);
    })();

    // Floor
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), wood);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, zBack + D / 2);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    // Rug
    const rugMat = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 1 });
    rugMat.colorNode = Fn(() => {
      const q = uv().sub(0.5);
      const border = smoothstep(float(0.44), float(0.45), abs(q.x).max(abs(q.y)));
      const n = mx_noise_float(vec3(uv().mul(80), 1)).mul(0.08).add(0.92);
      return mix(vec3(0.14, 0.12, 0.1), vec3(0.08, 0.07, 0.06), border).mul(n);
    })();
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.1, 0.004, 0.2);
    rug.receiveShadow = true;
    scene.add(rug);

    // Walls with a window opening in the back wall.
    const winW = 1.9;
    const winY0 = 0.95;
    const winY1 = 2.35;
    const winX = -0.1;
    b.box(W, H, 0.12, plaster, [0, H / 2, zBack + D + 0.06]); // front (behind camera)
    b.box(0.12, H, D, plaster, [-W / 2 - 0.06, H / 2, zBack + D / 2]);
    b.box(0.12, H, D, plaster, [W / 2 + 0.06, H / 2, zBack + D / 2]);
    // back wall pieces around the window
    const lw = winX - winW / 2 + W / 2;
    b.box(lw, H, 0.12, plaster, [-W / 2 + lw / 2, H / 2, zBack - 0.06]);
    const rw = W / 2 - (winX + winW / 2);
    b.box(rw, H, 0.12, plaster, [W / 2 - rw / 2, H / 2, zBack - 0.06]);
    b.box(winW, winY0, 0.12, plaster, [winX, winY0 / 2, zBack - 0.06]);
    b.box(winW, H - winY1, 0.12, plaster, [winX, (H + winY1) / 2, zBack - 0.06]);
    // window frame + sill
    b.box(winW + 0.1, 0.04, 0.26, deskWood, [winX, winY0, zBack + 0.02]);
    for (const x of [winX - winW / 2, winX + winW / 2]) b.box(0.05, winY1 - winY0, 0.14, black, [x, (winY0 + winY1) / 2, zBack - 0.04]);
    b.box(winW, 0.05, 0.14, black, [winX, winY1, zBack - 0.04]);
    b.box(0.04, winY1 - winY0, 0.1, black, [winX, (winY0 + winY1) / 2, zBack - 0.04]);
    // ceiling + skirting
    b.box(W, 0.1, D, plasterDark, [0, H + 0.05, zBack + D / 2]);
    b.box(W, 0.08, 0.02, plasterDark, [0, 0.04, zBack + 0.005]);
    b.box(0.02, 0.08, D, plasterDark, [-W / 2 + 0.01, 0.04, zBack + D / 2]);
    b.box(0.02, 0.08, D, plasterDark, [W / 2 - 0.01, 0.04, zBack + D / 2]);

    // Window glass with rain (no refraction needed at this size — keeps the room cheap).
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winY1 - winY0), createGlassMaterial({ refraction: quality.glassRefraction, width: winW, height: winY1 - winY0, env: null }));
    glass.position.set(winX, (winY0 + winY1) / 2, zBack - 0.05);
    glass.renderOrder = 5;
    scene.add(glass);
    this.rain = new THREE.Sprite(createRainMaterial({ min: V(-6, -4, -20), max: V(6, 5, -2.1) }));
    this.rain.count = Math.floor(quality.rainCount * 0.35);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 2;
    scene.add(this.rain);

    // ---------------------------------------------------------------- desk
    const deskZ = -1.35;
    const deskTopY = 0.74;
    b.box(1.5, 0.035, 0.72, deskWood, [0, deskTopY, deskZ]);
    for (const x of [-0.7, 0.7]) for (const z of [deskZ - 0.3, deskZ + 0.3]) b.box(0.035, deskTopY, 0.035, black, [x, deskTopY / 2, z]);
    b.box(1.4, 0.05, 0.02, black, [0, deskTopY - 0.06, deskZ - 0.33]);

    // Chair (pulled out, turned a little: someone just got up)
    const chair = new THREE.Group();
    {
      const cb = new Batch();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        cb.box(0.28, 0.025, 0.035, alu, [Math.cos(a) * 0.14, 0.06, Math.sin(a) * 0.14], [0, -a, 0]);
      }
      cb.cyl(0.022, 0.022, 0.36, alu, [0, 0.26, 0]);
      cb.rbox(0.48, 0.07, 0.46, 0.03, fabric, [0, 0.46, 0]);
      cb.rbox(0.44, 0.52, 0.06, 0.03, fabric, [0, 0.9, 0.25], [-0.1, 0, 0]);
      cb.build(chair);
    }
    chair.position.set(0.95, 0, -0.5);
    chair.rotation.y = -0.9;
    scene.add(chair);

    // Laptop: base + hinged lid with the screen.
    const laptopGroup = new THREE.Group();
    laptopGroup.position.set(-0.05, deskTopY + 0.0175, deskZ + 0.05);
    laptopGroup.rotation.y = 0.05;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.23), alu);
    base.position.y = 0.007;
    base.castShadow = true;
    laptopGroup.add(base);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), black);
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, 0.0145, -0.03);
    laptopGroup.add(keys);
    const lid = new THREE.Group();
    lid.position.set(0, 0.014, -0.115);
    const lidShell = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.225, 0.008), alu);
    lidShell.position.set(0, 0.1125, -0.004);
    lidShell.castShadow = true;
    lid.add(lidShell);
    this.laptop = new Screen(768, 480, 0xf2f6ff, 0.35);
    this.laptop.fps = 30;
    this.laptop.painter = (ctx, w, h, t) => this.paintLaptop(ctx, w, h, t);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.315, 0.197), this.laptop.material);
    scr.position.set(0, 0.1125, 0.0002);
    lid.add(scr);
    lid.rotation.x = -0.32;
    laptopGroup.add(lid);
    this.lid = lid;
    scene.add(laptopGroup);
    this.onDispose(() => this.laptop.dispose());

    // Headphones (resting on the desk, on their side)
    {
      const hp = new THREE.Group();
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.008, 8, 32, Math.PI), black);
      hp.add(band);
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 24), black);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(s * 0.085, -0.01, 0);
        hp.add(cup);
        const pad = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 8, 20), fabric);
        pad.rotation.y = Math.PI / 2;
        pad.position.set(s * 0.07, -0.01, 0);
        hp.add(pad);
      }
      hp.rotation.set(0, 0.7, 0);
      hp.position.set(0.5, deskTopY + 0.056, deskZ - 0.02);
      hp.traverse((o) => (o.castShadow = true));
      scene.add(hp);
    }
    // Notebook + pen
    {
      const nbMat = new THREE.MeshStandardNodeMaterial({ color: 0x1d2a2f, roughness: 0.8 });
      const nb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.21), nbMat);
      nb.position.set(-0.42, deskTopY + 0.024, deskZ + 0.12);
      nb.rotation.y = 0.25;
      nb.castShadow = true;
      scene.add(nb);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.01, 0.205), new THREE.MeshStandardNodeMaterial({ color: 0xcfc7b6, roughness: 0.9 }));
      pages.position.set(-0.42, deskTopY + 0.024, deskZ + 0.12);
      pages.rotation.y = 0.25;
      pages.scale.set(0.97, 1.05, 0.99);
      scene.add(pages);
      const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 8), alu);
      pen.rotation.set(Math.PI / 2, 0, 0.9);
      pen.position.set(-0.36, deskTopY + 0.034, deskZ + 0.1);
      scene.add(pen);
    }
    // Coffee mug with steam
    {
      const ceramic = new THREE.MeshStandardNodeMaterial({ color: 0x2b2f33, roughness: 0.3 });
      const pts = [V(0, 0, 0), V(0.038, 0, 0), V(0.042, 0.006, 0), V(0.043, 0.095, 0), V(0.039, 0.095, 0), V(0.038, 0.012, 0), V(0, 0.012, 0)].map((p) => new THREE.Vector2(p.x, p.y));
      const mug = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), ceramic);
      mug.position.set(0.3, deskTopY + 0.018, deskZ + 0.22);
      mug.castShadow = true;
      scene.add(mug);
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 16, Math.PI), ceramic);
      handle.position.set(0.3 + 0.043, deskTopY + 0.065, deskZ + 0.22);
      handle.rotation.z = -Math.PI / 2;
      scene.add(handle);
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.037, 24), new THREE.MeshStandardNodeMaterial({ color: 0x120904, roughness: 0.05 }));
      coffee.rotation.x = -Math.PI / 2;
      coffee.position.set(0.3, deskTopY + 0.1, deskZ + 0.22);
      scene.add(coffee);
      const steamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      steamMat.colorNode = Fn(() => {
        const q = uv();
        const n = mx_noise_float(vec3(q.x.mul(3), q.y.mul(2).sub(time.mul(0.5)), time.mul(0.1)));
        const wisp = smoothstep(float(0.25), float(0.0), abs(q.x.sub(0.5).add(n.mul(0.25)).add(sin(q.y.mul(6).sub(time)).mul(0.08))));
        const fade = smoothstep(float(0.0), float(0.15), q.y).mul(smoothstep(float(1.0), float(0.4), q.y));
        const a = wisp.mul(fade).mul(0.12).mul(this.u.steam);
        return vec4(vec3(0.9, 0.85, 0.8).mul(a), a);
      })();
      this.steam = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.22), steamMat);
      this.steam.position.set(0.3, deskTopY + 0.22, deskZ + 0.22);
      scene.add(this.steam);
    }
    // Desk lamp (articulated arm, warm shade)
    const lampHead = V(-0.55, deskTopY + 0.46, deskZ - 0.08);
    {
      const lb = new Batch();
      lb.cyl(0.07, 0.08, 0.02, black, [-0.62, deskTopY + 0.01, deskZ - 0.2]);
      lb.cyl(0.008, 0.008, 0.38, alu, [-0.62, deskTopY + 0.2, deskZ - 0.2], [0.25, 0, 0.1]);
      lb.cyl(0.008, 0.008, 0.3, alu, [-0.6, deskTopY + 0.42, deskZ - 0.14], [-0.9, 0, 0.05]);
      lb.cyl(0.02, 0.065, 0.1, black, [lampHead.x, lampHead.y, lampHead.z], [-0.25, 0, 0.7]);
      lb.build(scene);
      const bulbMat = new THREE.MeshBasicNodeMaterial();
      const bc = vec3(1.0, 0.72, 0.42).mul(6);
      bulbMat.colorNode = bc;
      bulbMat.mrtNode = mrt({ emissive: vec4(bc.mul(0.4), 1) });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), bulbMat);
      bulb.position.copy(lampHead).add(V(0.025, -0.03, 0.01));
      scene.add(bulb);
    }
    // Plant (pot + simple leaves)
    {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 20), createPaintedMaterial(0x6b4a36, 0.8, 0, 0.2));
      pot.position.set(1.65, 0.9, deskZ - 0.1);
      scene.add(pot);
      const leafMat = new THREE.MeshStandardNodeMaterial({ color: 0x1f3a22, roughness: 0.6, side: THREE.DoubleSide });
      for (let i = 0; i < 9; i++) {
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), leafMat);
        leaf.scale.set(0.35, 1.5, 0.08);
        const a = (i / 9) * Math.PI * 2;
        leaf.position.set(1.65 + Math.cos(a) * 0.05, 1.03 + (i % 3) * 0.03, deskZ - 0.1 + Math.sin(a) * 0.05);
        leaf.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6);
        scene.add(leaf);
      }
      // small side cabinet under the plant
      b.box(0.5, 0.84, 0.45, deskWood, [1.65, 0.42, deskZ - 0.1]);
    }
    // Shelf with books
    {
      b.box(1.1, 0.03, 0.22, deskWood, [1.3, 1.75, zBack + 0.11]);
      const bookColors = [0x2a2a2a, 0x5b4636, 0x31414a, 0x6e6a60, 0x3b2b2b, 0x24323a, 0x8a7d66];
      let x = 0.82;
      for (let i = 0; i < 11; i++) {
        const w = 0.025 + ((i * 7) % 4) * 0.008;
        const hgt = 0.17 + ((i * 5) % 5) * 0.015;
        const mat = createPaintedMaterial(bookColors[i % bookColors.length], 0.8, 0, 0.15);
        const lean = i === 10 ? 0.25 : 0;
        b.box(w, hgt, 0.16, mat, [x, 1.765 + hgt / 2, zBack + 0.11], [0, 0, lean]);
        x += w + 0.004;
      }
    }
    // Framed print on the side wall (abstract city line drawing)
    {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 320;
      const g = c.getContext("2d")!;
      g.fillStyle = "#d9d2c4";
      g.fillRect(0, 0, 256, 320);
      g.strokeStyle = "#2a2a2a";
      g.lineWidth = 2;
      g.beginPath();
      let px = 20;
      g.moveTo(20, 260);
      for (let i = 0; i < 12; i++) {
        const hh = 60 + ((i * 53) % 130);
        g.lineTo(px, 260 - hh);
        px += 18;
        g.lineTo(px, 260 - hh);
      }
      g.lineTo(px, 260);
      g.stroke();
      g.fillStyle = "#2a2a2a";
      g.font = `10px ${MONO}`;
      g.fillText("OBS-07 — 1:2000", 20, 292);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const print = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), new THREE.MeshStandardNodeMaterial({ map: tex, roughness: 0.85 }));
      print.position.set(-W / 2 + 0.015, 1.55, -0.2);
      print.rotation.y = Math.PI / 2;
      scene.add(print);
      b.box(0.03, 0.54, 0.44, black, [-W / 2 + 0.005, 1.55, -0.2]);
      this.onDispose(() => tex.dispose());
    }
    b.build(scene);

    // ---------------------------------------------------------------- lights
    const lamp = new THREE.SpotLight(0xffb070, 5, 3.2, 1.1, 1.0, 1.6);
    lamp.position.copy(lampHead);
    lamp.target.position.set(-0.15, deskTopY, deskZ + 0.1);
    lamp.castShadow = quality.shadows;
    if (lamp.castShadow) {
      lamp.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      lamp.shadow.bias = -0.0005;
      lamp.shadow.normalBias = 0.01;
      lamp.shadow.camera.near = 0.05;
      lamp.shadow.camera.far = 3.5;
    }
    const bounce = new THREE.PointLight(0xff9a55, 1.2, 4, 1.8);
    bounce.position.set(-0.3, 0.9, deskZ + 0.4);
    const win = new THREE.DirectionalLight(0x7088aa, 0.7);
    win.position.set(-1, 6, -12);
    const screenLight = new THREE.PointLight(0xcfe0ff, 0, 1.6, 1.8);
    screenLight.position.set(-0.05, deskTopY + 0.15, deskZ + 0.1);
    const ambient = new THREE.HemisphereLight(0x2a2a30, 0x100a06, 0.35);
    scene.add(lamp, lamp.target, bounce, win, screenLight, ambient);
    this.lights = { lamp, bounce, window: win, screen: screenLight, ambient };

    // Warm environment for reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x1a1410);
    const warmPanel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(4) }));
    warmPanel.position.set(-1, 1, 0);
    warmPanel.lookAt(0, 0, 0);
    const coolPanel = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.3, 0.4) }));
    coolPanel.position.set(0, 1, -3);
    coolPanel.lookAt(0, 1, 0);
    env.add(warmPanel, coolPanel);
    scene.environment = pmrem.fromScene(env, 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
    env.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });

    await renderer.compileAsync(scene, this.ctx.cameras.camera).catch(() => undefined);
    void length;
    void FA;
  }

  enter(): void {
    super.enter();
    const { cameras, post } = this.ctx;
    cameras.register(this.poses);
    post.setScene(this.scene);
    cameras.set("finalStart");
    this.laptopState = "off";
    this.laptop.power.value = 0;
    this.lid.rotation.x = -0.32;
    this.lights.screen.intensity = 0;
    post.applyGrade({ exposure: 1.05, saturation: 0.95, bloom: 0.7, vignette: 0.42 });
    (post.u.lift.value as THREE.Color).setRGB(0.012, 0.006, 0.0);
    (post.u.gain.value as THREE.Color).setRGB(1.06, 1.0, 0.92);
    post.u.glitch.value = 0;
    post.u.warp.value = 0;
    for (const l of [this.lights.lamp]) if (l.castShadow) l.shadow.needsUpdate = true;
  }

  /** Slow move through the room to the desk. */
  walkIn(): Promise<void> {
    return this.ctx.cameras.goTo("finalRoom", { duration: 7, ease: "power1.inOut" });
  }

  async laptopOn(signal: AbortSignal): Promise<void> {
    const { audio, cameras } = this.ctx;
    audio.laptopChime();
    this.laptopState = "boot";
    this.laptopSince = 0;
    gsap.to(this.laptop.power, { value: 1, duration: 0.6 });
    gsap.to(this.lights.screen, { intensity: 1.2, duration: 1 });
    gsap.to(this.lights.lamp, { intensity: 3.5, duration: 3 });
    cameras.goTo("laptop", { duration: 4.5, ease: "power2.inOut" });
    await wait(2200, signal);
    this.laptopState = "reveal";
    this.laptopSince = 0;
    this.revealSince = 0;
    this.revealStart = performance.now();
    this.typed = 0;
    await wait(3600, signal);
  }

  showHello(): void {
    this.laptopState = "hello";
    this.laptopSince = 0;
    this.ctx.audio.fragment(2);
  }

  private paintLaptop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const s = this.laptopSince;
    if (this.laptopState === "off") return clear(ctx, w, h, "#000");
    clear(ctx, w, h, "#07090b");
    if (this.laptopState === "boot") {
      const k = Math.min(1, s / 1.5);
      ctx.fillStyle = `rgba(223,228,234,${0.12 + k * 0.2})`;
      ctx.fillRect(w / 2 - 80, h / 2 + 30, 160 * k, 2);
      text(ctx, "●", w / 2, h / 2 - 10, 20, "#dfe4ea", { align: "center", alpha: 0.4 + 0.6 * Math.abs(Math.sin(t * 2)) });
      return;
    }
    const lines = ["UNKNOWN SYSTEM", "CREATED BY", CREATOR.nameLatin];
    const total = lines.join("").length;
    // Wall-clock typing so slow frames never stall the reveal text.
    this.typed = Math.min(total, Math.floor(((performance.now() - this.revealStart) / 1000) * 12));
    let left = this.typed;
    const y0 = this.laptopState === "hello" ? h * 0.3 : h * 0.4;
    lines.forEach((l, i) => {
      const n = Math.max(0, Math.min(l.length, left));
      left -= l.length;
      const size = i === 2 ? 34 : i === 0 ? 30 : 16;
      const col = i === 1 ? "#6d7a86" : i === 2 ? "#f0d2a8" : "#dfe4ea";
      text(ctx, l.slice(0, n), w / 2, y0 + [0, 48, 92][i], size, col, { align: "center", spacing: i === 1 ? 6 : 4, weight: i === 1 ? 400 : 600 });
    });
    if (this.typed < total && Math.sin(t * 8) > 0) {
      ctx.fillStyle = "#dfe4ea";
      ctx.fillRect(w / 2 + 170, y0 + 80, 12, 24);
    }
    if (this.laptopState === "hello") {
      const k = Math.min(1, s / 1.2);
      text(ctx, ".... . .-.. .-.. ---", w / 2, h * 0.68, 20, "#6f8fa3", { align: "center", spacing: 6, alpha: k });
      text(ctx, `HELLO, ${(this.ctx.store.get().name || "").toUpperCase()}`, w / 2, h * 0.78, 22, "#bfe9ff", { align: "center", spacing: 4, alpha: Math.max(0, Math.min(1, (s - 0.9) / 1)) });
    }
    const st = this.ctx.store.get();
    text(ctx, `power ok · signal ${st.signalChoice ?? "-"} · memory 3/3 · user ${st.name || "?"}`, 24, h - 22, 12, "#3d4b57", { spacing: 1 });
  }

  update(dt: number, t: number): void {
    if (!this.active) return;
    this.laptopSince += dt;
    this.revealSince += dt;
    this.laptop.update(dt);
    // Lamp filament flicker, tiny.
    this.lights.lamp.intensity *= 1;
    this.lights.bounce.intensity = 1.1 + Math.sin(t * 0.7) * 0.05;
    this.steam.lookAt(this.ctx.cameras.camera.position.x, this.steam.position.y, this.ctx.cameras.camera.position.z);
  }
}
