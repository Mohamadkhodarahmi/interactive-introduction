import * as THREE from "three/webgpu";
import gsap from "gsap";
import { color, densityFogFactor, fog, uniform } from "three/tsl";
import { BaseScene } from "../../core/BaseScene";
import type { AppContext } from "../../core/AppContext";
import type { CameraPose } from "../../camera/CameraManager";
import { buildCity, type City } from "./cityBuilder";
import { buildRoom, roomUniforms, LEAK, DOOR, ROOM, type Room } from "./room";
import { Signal } from "./signal";
import { paintCenter, paintDoor, paintLeft, paintRight, type ConsoleView, type DoorView } from "./painters";
import { cityUniforms } from "../../rendering/materials/city";
import { skyUniforms } from "../../rendering/materials/sky";
import { rainUniforms, createRainMaterial, createSplashMaterial } from "../../rendering/materials/rain";
import { glassUniforms } from "../../rendering/materials/surfaces";
import { buildEnvironment, type EnvSpec } from "../../rendering/environment";
import { wait } from "../../core/Timeline";
import { PlanarReflection } from "../../rendering/PlanarReflection";
import { screenUV, texture } from "three/tsl";
import type { N } from "../../rendering/materials/tslUtils";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const BOOT_LINES = [
  "OBS-07 FIRMWARE 4.1.9",
  "MAIN BUS 07 ............ OK",
  "UPS BANK A ............. OK",
  "UPS BANK B ............. FAIL",
  "LIGHTING GRID .......... OK",
  "EXTERIOR SENSORS ....... OK",
  "CORE CLOCK RESYNC ...... OK",
  "SIGNAL ARRAY ........... OK",
  "MEMORY MODULE .......... NOT CHECKED",
  "IDENTITY SERVICE ....... LOCKED",
  "",
  "MODULE 1/3 POWER ....... OK",
];

/**
 * Scene 0–2 and 4–5: the observation room above the city.
 * Visual primitives for the story live here; the Director sequences them.
 */
export class ObservationScene extends BaseScene {
  readonly id = "observation";
  poses: Record<string, CameraPose> = {
    observationRoom: {
      position: V(1.0, 1.62, 2.5),
      target: V(-0.35, 1.3, -6),
      fov: 52,
      sway: 0.01,
      look: { yaw: 0.55, pitch: 0.22 },
      portrait: { position: V(0.55, 1.6, 3.2), target: V(-0.1, 1.2, -6), fov: 52 },
    },
    console: {
      position: V(1.62, 1.5, -1.6),
      target: V(2.45, 0.86, -3.05),
      fov: 46,
      sway: 0.006,
      look: { yaw: 0.25, pitch: 0.12 },
      portrait: { position: V(1.9, 1.55, -1.35), target: V(2.45, 0.86, -3.05), fov: 50 },
    },
    monitor: {
      position: V(0.0, 1.44, -2.28),
      target: V(0.0, 1.45, -3.8),
      fov: 44,
      sway: 0.004,
      look: { yaw: 0.3, pitch: 0.1 },
      portrait: { position: V(0.0, 1.45, -2.0), target: V(0.0, 1.45, -3.8), fov: 46 },
    },
    window: {
      position: V(0.25, 1.5, -3.95),
      target: V(-0.9, 1.75, -30),
      fov: 55,
      sway: 0.014,
      look: { yaw: 0.5, pitch: 0.3 },
    },
    signal: {
      position: V(0.5, 1.72, -0.9),
      target: V(-40, 10, -200),
      fov: 42,
      sway: 0.008,
      look: { yaw: 0.35, pitch: 0.15 },
    },
    identity: {
      position: V(2.7, 1.62, 1.9),
      target: V(6, 1.35, -0.2),
      fov: 50,
      sway: 0.006,
      look: { yaw: 0.35, pitch: 0.12 },
      portrait: { position: V(3.0, 1.6, 2.1), target: V(6, 1.3, 0.0), fov: 52 },
    },
    reveal: {
      position: V(5.0, 1.62, 0.35),
      target: V(9, 1.45, 0.3),
      fov: 55,
      sway: 0.004,
    },
  };

  room!: Room;
  city!: City;
  signal!: Signal;
  view: ConsoleView = {
    mode: "off",
    since: 0,
    decoded: "",
    gate: 0,
    scope: new Array(96).fill(0),
    bearing: 347,
    distanceKm: 1.14,
    rain: 0.55,
    wind: 0.2,
    choice: null,
    name: "",
    bootLines: BOOT_LINES,
  };
  door: DoorView = { state: "locked", name: "", since: 0 };
  private rain!: THREE.Sprite;
  private splashes!: THREE.Sprite;
  private envOffline!: THREE.Texture;
  private envPowered!: THREE.Texture;
  private envWarm!: THREE.Texture;
  private emergencyU!: { value: number };
  private emergencyOn = 1;
  private dripT = 0;
  private dripPeriod = 2.2;
  private lightningTimer = 9;
  private stormLevel = 0;
  private scopeAcc = 0;
  private fogDensity = uniform(0.00055);
  private signalAudio = { level: 0, pan: 0, pitch: 880 };
  private lastGate = -1;
  private lastSignalLevel = -1;
  private lastSignalPan = 0;
  private breakerDone = false;
  private powered = false;
  /** Signal is far out over the city by default; ignore branch brings it close. */
  signalFar = V(-190, 150, -1100);
  signalNear = V(-1.1, 2.2, -8.2);
  private signalLight = 0;
  private screensEnabled = true;
  private flickerTween: gsap.core.Tween | null = null;
  private reflection: PlanarReflection | null = null;

  constructor(ctx: AppContext) {
    super(ctx);
  }

  protected async build(): Promise<void> {
    const { renderer, quality } = this.ctx;
    const scene = this.scene;
    scene.background = new THREE.Color(0x020304);

    const envBase: Omit<EnvSpec, "panels"> = {
      room: { w: 12, h: 3.6, d: 9.6, center: [0, 1.8, -0.8] },
      wall: 0x07080a,
      floor: 0x050506,
      window: { position: [0, 1.9, -5.0], size: [12, 3], normal: [0, 0, 1], top: 0x0a0d14, bottom: 0x2a2226, intensity: 1 },
    };
    this.envOffline = buildEnvironment(renderer, {
      ...envBase,
      panels: [{ position: [5.9, 2.8, 0.3], size: [0.4, 0.4], normal: [-1, 0, 0], color: 0xff2010, intensity: 2 }],
    });
    const ceilingPanels = [-3.15, -1.05, 1.05].flatMap((z) => [-2.2, 2.2].map((x) => ({ position: [x, 3.3, z] as [number, number, number], size: [1.8, 0.3] as [number, number], normal: [0, -1, 0] as [number, number, number], color: 0xffe2c0, intensity: 7 })));
    this.envPowered = buildEnvironment(renderer, {
      ...envBase,
      wall: 0x1a1c1f,
      floor: 0x0e0f10,
      panels: [...ceilingPanels, { position: [0, 1.45, -3.7], size: [2.6, 0.5], normal: [0, 0, 1], color: 0x9fcfff, intensity: 1.5 }],
    });
    this.envWarm = buildEnvironment(renderer, {
      ...envBase,
      wall: 0x1c1a18,
      floor: 0x0f0e0d,
      panels: [...ceilingPanels.map((p) => ({ ...p, color: 0xffc890, intensity: 6 })), { position: [5.95, 1.2, 0.3], size: [1.3, 2.3], normal: [-1, 0, 0], color: 0xffa860, intensity: 4 }],
    });
    scene.environment = this.envOffline;
    scene.environmentIntensity = 0.6;

    this.city = buildCity(quality);
    scene.add(this.city.group);

    if (quality.level !== "low" && !new URLSearchParams(location.search).has("norefl")) {
      this.reflection = new PlanarReflection(renderer, 0.001, quality.level === "high" ? 0.5 : 0.35);
      const tex = this.reflection.target.texture;
      this.onDispose(() => this.reflection?.dispose());
      this.room = buildRoom(quality, this.envPowered, (o: N) => texture(tex, screenUV.flipX().add(o)));
    } else {
      this.room = buildRoom(quality, this.envPowered, null);
    }
    scene.add(this.room.group);
    this.emergencyU = this.room.emergencyLamp.userData.u;

    // Rain outside the glass + splashes on the ledge.
    this.rain = new THREE.Sprite(createRainMaterial({ min: V(-16, -12, -48), max: V(16, 12, -5.3) }));
    this.rain.count = quality.rainCount;
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 2;
    scene.add(this.rain);
    this.splashes = new THREE.Sprite(createSplashMaterial({ x0: -6.5, x1: 6.5, z0: -6.15, z1: -4.9, y: this.room.ledgeY + 0.005 }));
    this.splashes.count = Math.floor(quality.rainCount / 12);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 3;
    scene.add(this.splashes);

    this.signal = new Signal();
    this.signal.setPosition(this.signalFar);
    scene.add(this.signal.group);
    this.poses.signal.target = this.signalFar.clone();

    // Atmospheric fog (same colour as the sky's horizon haze).
    scene.fogNode = fog(color(0x0b0c10), densityFogFactor(this.fogDensity));

    // Screens
    const s = this.room.consoleScreens;
    s.center.painter = paintCenter(this.view);
    s.left.painter = paintLeft(this.view);
    s.right.painter = paintRight(this.view);
    this.room.doorScreen.painter = paintDoor(this.door);
    this.room.doorScreen.power.value = 1;
    this.room.doorScreen.brightness.value = 0.6;

    this.onDispose(() => {
      [this.envOffline, this.envPowered, this.envWarm].forEach((t) => t.dispose());
      Object.values(s).forEach((sc) => sc.dispose());
      this.room.doorScreen.dispose();
    });

    // Warm-up compile so the first frame doesn't hitch.
    await renderer.compileAsync(scene, this.ctx.cameras.camera).catch(() => undefined);
  }

  /** Reset to the "offline" initial look. */
  resetLook(): void {
    roomUniforms.power.value = 0;
    roomUniforms.ceiling.value = 0;
    roomUniforms.standby.value = 1;
    roomUniforms.racks.value = 0;
    roomUniforms.doorGlow.value = 0;
    (roomUniforms.ceilingColor.value as THREE.Color).setRGB(1.0, 0.88, 0.74);
    cityUniforms.powerRadius.value = 0;
    cityUniforms.brightness.value = 0.75;
    cityUniforms.flash.value = 0;
    skyUniforms.glow.value = 0.45;
    rainUniforms.intensity.value = 0.55;
    rainUniforms.wind.value = 0.16;
    rainUniforms.brightness.value = 0.5;
    glassUniforms.rain.value = 0.55;
    glassUniforms.storm.value = 0;
    glassUniforms.reflection.value = 0.04;
    this.fogDensity.value = 0.00055;
    this.scene.environment = this.envOffline;
    this.scene.environmentIntensity = 0.6;
    const L = this.room.lights;
    L.city.intensity = 0.9;
    L.ambient.intensity = 0.35;
    L.ceiling.forEach((c) => (c.intensity = 0));
    L.console.intensity = 0;
    L.door.intensity = 0;
    L.doorWash.intensity = 0;
    L.flash.intensity = 0;
    this.emergencyOn = 1;
    this.view.mode = "off";
    this.view.decoded = "";
    this.view.name = "";
    this.view.choice = null;
    this.door.state = "locked";
    this.door.name = "";
    Object.values(this.room.consoleScreens).forEach((sc) => {
      sc.power.value = 0;
      sc.noise.value = 0;
    });
    this.room.breaker.cover.rotation.x = 0;
    this.room.breaker.lever.rotation.x = 0.35;
    this.room.doorLeaf.position.z = DOOR.z;
    this.signal.u.visible.value = 0;
    this.signal.u.intensity.value = 1;
    this.signal.u.size.value = 0.02;
    this.signal.setPosition(this.signalFar);
    this.signalLight = 0;
    this.stormLevel = 0;
    this.breakerDone = false;
    this.powered = false;
    this.signalAudio.level = 0;
    this.refreshShadows();
  }

  enter(): void {
    super.enter();
    const { cameras, audio } = this.ctx;
    cameras.register(this.poses);
    this.ctx.post.setScene(this.scene);
    audio.drips = false;
  }

  /** Ambience for the current phase. */
  applyAmbience(phase: "offline" | "powered" | "storm" | "quiet" | "calm" | "warm"): void {
    const a = this.ctx.audio;
    switch (phase) {
      case "offline":
        a.setRain(0.55, 0.1);
        a.setCity(0.5);
        a.setHum(0);
        a.setMuffle(0.15);
        break;
      case "powered":
        a.setRain(0.6, 0.15);
        a.setCity(0.65);
        a.setHum(1);
        a.setMuffle(0.1);
        break;
      case "storm":
        a.setRain(1, 1, 3);
        a.setCity(0.8);
        a.setHum(0.7);
        a.setMuffle(0);
        break;
      case "quiet":
        a.setRain(0.3, 0, 4);
        a.setCity(0.2, 4);
        a.setHum(0.25, 3);
        a.setMuffle(0.4, 4);
        break;
      case "calm":
        a.setRain(0.4, 0.05, 3);
        a.setCity(0.45, 3);
        a.setHum(0.6, 2);
        a.setMuffle(0.2, 3);
        break;
      case "warm":
        a.setRain(0.3, 0, 4);
        a.setCity(0.35, 4);
        a.setHum(0.4, 3);
        a.setMuffle(0.35, 4);
        break;
    }
  }

  // ------------------------------------------------------------------ hotspots

  registerHotspots(handlers: {
    breaker: () => void;
    window: () => void;
    screens: () => void;
    racks: () => void;
    door: () => void;
  }): void {
    const { interactor } = this.ctx;
    interactor.clear();
    interactor.add({ id: "breaker", objects: [this.room.breaker.body], onTap: handlers.breaker, enabled: false, anchor: this.room.breaker.anchor });
    interactor.add({ id: "window", objects: this.room.glass, onTap: handlers.window, enabled: true });
    interactor.add({ id: "screens", objects: this.room.screenMeshes, onTap: handlers.screens, enabled: true });
    interactor.add({ id: "racks", objects: this.room.racks, onTap: handlers.racks, enabled: true });
    interactor.add({ id: "door", objects: [this.room.doorLeaf, this.room.doorPanel], onTap: handlers.door, enabled: true });
  }

  get breakerAnchor(): THREE.Vector3 {
    return this.room.breaker.anchor;
  }

  get doorAnchor(): THREE.Vector3 {
    return V(ROOM.x1 - 0.05, 1.3, DOOR.z);
  }

  // ------------------------------------------------------------------ story visuals

  standby(): void {
    this.view.mode = "standby";
    this.view.since = 0;
    Object.values(this.room.consoleScreens).forEach((s) => (s.power.value = 0.25));
    this.room.consoleScreens.left.power.value = 0;
    this.room.consoleScreens.right.power.value = 0;
  }

  screensOff(): void {
    if (this.powered) return;
    this.view.mode = "off";
    Object.values(this.room.consoleScreens).forEach((s) => (s.power.value = 0));
  }

  flashDoor(state: DoorView["state"], ms = 1600): void {
    const prev = this.door.state;
    this.door.state = state;
    this.door.since = 0;
    window.setTimeout(() => {
      if (this.door.state === state) this.door.state = prev;
    }, ms);
  }

  /** Breaker animation (cover flips, lever throws). */
  async throwBreaker(): Promise<void> {
    if (this.breakerDone) return;
    this.breakerDone = true;
    const { cover, lever } = this.room.breaker;
    this.ctx.audio.breaker();
    await new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: resolve })
        .to(cover.rotation, { x: -1.75, duration: 0.35, ease: "power3.out" })
        .to(lever.rotation, { x: 2.6, duration: 0.22, ease: "power4.in" }, 0.3)
        .to({}, { duration: 0.1 });
    });
    this.ctx.cameras.shake(0.012, 0.35);
    roomUniforms.standby.value = 0;
  }

  /** Staged power-up: flicker, lights, screens, city wave. */
  async restorePower(signal?: AbortSignal): Promise<void> {
    const { audio, post } = this.ctx;
    const L = this.room.lights;
    this.powered = true;
    this.emergencyOn = 0;
    audio.powerUp();
    await wait(700, signal);

    // Ceiling fixtures stutter on, one bank at a time.
    const flick = async (level: number, ms: number) => {
      roomUniforms.ceiling.value = level;
      L.ceiling.forEach((c) => (c.intensity = level * 14));
      if (level > 0.3) audio.lightFlicker();
      await wait(ms, signal);
    };
    await flick(0.7, 60);
    await flick(0, 140);
    await flick(0.9, 50);
    await flick(0.1, 260);
    await flick(1, 40);
    await flick(0.3, 90);
    audio.lightOn();
    roomUniforms.ceiling.value = 1;
    this.scene.environment = this.envPowered;
    gsap.to(this.scene, { environmentIntensity: 0.9, duration: 1.2 });
    L.ceiling.forEach((c) => gsap.to(c, { intensity: 16, duration: 0.3 }));
    gsap.to(L.ambient, { intensity: 0.55, duration: 1.5 });
    this.refreshShadows();
    audio.setHum(1, 1.2);

    // Console and screens boot.
    await wait(450, signal);
    roomUniforms.power.value = 1;
    roomUniforms.racks.value = 1;
    this.view.mode = "boot";
    this.view.since = 0;
    Object.values(this.room.consoleScreens).forEach((s) => gsap.to(s.power, { value: 1, duration: 0.25 }));
    gsap.to(L.console, { intensity: 2.2, duration: 0.8 });
    audio.boot();
    gsap.to(glassUniforms.reflection, { value: 0.18, duration: 1.5 });

    // City comes back in a wave from the facility outward.
    await wait(600, signal);
    gsap.to(cityUniforms.powerRadius, { value: 3200, duration: 7, ease: "power1.in" });
    gsap.to(cityUniforms.brightness, { value: 1, duration: 6 });
    gsap.to(skyUniforms.glow, { value: 0.7, duration: 7 });
    gsap.to(rainUniforms.brightness, { value: 0.8, duration: 3 });
    gsap.to(L.city, { intensity: 1.3, duration: 6 });
    post.applyGrade({ exposure: 1.0 });
    this.applyAmbience("powered");
    await wait(2400, signal);
  }

  bootComplete(): void {
    this.view.mode = "idle";
    this.view.since = 0;
  }

  /** The unknown light appears over the city. */
  async revealSignal(signal?: AbortSignal): Promise<void> {
    const s = this.signal;
    s.setPosition(this.signalFar);
    s.u.size.value = 0.018;
    gsap.to(s.u.visible, { value: 1, duration: 2.5, ease: "power2.inOut" });
    this.signalAudio.level = 0.5;
    this.signalAudio.pan = -0.35;
    this.view.mode = "signal";
    this.view.since = 0;
    await wait(1200, signal);
  }

  /** Branch A: move to the glass, let the storm in. */
  async approach(signal?: AbortSignal): Promise<void> {
    const { cameras, audio } = this.ctx;
    this.view.mode = "exterior";
    this.view.since = 0;
    this.poses.window.target = this.signalFar.clone().add(V(0, -20, 0)).multiplyScalar(0.03).add(V(0.2, 1.6, -4));
    cameras.goTo("window", { duration: 3.6, ease: "power2.inOut" });
    audio.whoosh(2.4);
    this.applyAmbience("storm");
    this.stormLevel = 1;
    gsap.to(glassUniforms.storm, { value: 1, duration: 4 });
    gsap.to(glassUniforms.rain, { value: 1, duration: 4 });
    gsap.to(rainUniforms.intensity, { value: 1, duration: 3 });
    gsap.to(rainUniforms.wind, { value: 0.34, duration: 4 });
    gsap.to(this.fogDensity, { value: 0.0008, duration: 4 });
    gsap.to(this.signal.u.size, { value: 0.03, duration: 4 });
    gsap.to(this.signal.u.intensity, { value: 1.8, duration: 4 });
    this.signalAudio.level = 0.9;
    this.lightningTimer = 2.5;
    await wait(3800, signal);
    this.strike(0.25);
    await wait(1400, signal);
  }

  /** Branch B: stay inside and reconstruct the signal on the main monitor. */
  async investigate(signal?: AbortSignal): Promise<void> {
    const { cameras, audio } = this.ctx;
    this.view.mode = "decode";
    this.view.since = 0;
    this.view.decoded = "";
    cameras.goTo("monitor", { duration: 2.8 });
    audio.servo();
    this.signalAudio.level = 0.6;
    this.signalAudio.pan = 0;
    await wait(3000, signal);
    audio.scan();
    // Decode letter by letter, in time with the actual transmission.
    for (const ch of ["H", "E", "L", "L"]) {
      await wait(1500 + Math.random() * 500, signal);
      this.view.decoded += ch;
      audio.tick();
      audio.confirm();
    }
    await wait(1200, signal);
  }

  /** Branch C: ignore it. The room quiets, the light goes out… and comes back close. */
  async ignoreSignal(signal?: AbortSignal, onVanish?: () => Promise<void>): Promise<void> {
    const { cameras, audio, post } = this.ctx;
    this.view.mode = "idle";
    cameras.goTo("observationRoom", { duration: 3 });
    gsap.to(this.signal.u.visible, { value: 0, duration: 2.2 });
    this.signalAudio.level = 0;
    this.applyAmbience("quiet");
    audio.setPadLevel(0.15, 4);
    gsap.to(post.u.exposure, { value: 0.85, duration: 4 });
    L_dim(this.room.lights.ceiling, 0.6);
    if (onVanish) await onVanish();
    await wait(4200, signal);
    // It returns — just outside the glass.
    this.signal.setPosition(this.signalNear);
    this.signal.u.size.value = 0.016;
    this.poses.signal.target = this.signalNear.clone();
    this.poses.signal.position = V(0.1, 1.55, -1.6);
    audio.glitch(0.4);
    audio.setSignal(0.8, -0.2, 660);
    this.signalAudio.level = 1;
    this.signalAudio.pan = -0.2;
    gsap.to(this.signal.u.visible, { value: 1, duration: 0.25 });
    this.signalLight = 1;
    gsap.to(post.u.exposure, { value: 1, duration: 1 });
    cameras.goTo("signal", { duration: 1.6, ease: "power3.out" });
    await wait(1800, signal);
  }

  /** Lightning strike (flash on sky, city and room + thunder). */
  strike(distance = 0.6): void {
    const f = { v: 0 };
    const L = this.room.lights;
    (skyUniforms.flashDir.value as THREE.Vector3).set((Math.random() - 0.5) * 1.4, 0.15 + Math.random() * 0.2, -1).normalize();
    const peak = 1.2 * (1 - distance * 0.5);
    gsap
      .timeline()
      .to(f, { v: peak, duration: 0.04 })
      .to(f, { v: 0.1, duration: 0.08 })
      .to(f, { v: peak * 0.8, duration: 0.05 })
      .to(f, { v: 0, duration: 0.9, ease: "power2.out" })
      .eventCallback("onUpdate", () => {
        cityUniforms.flash.value = f.v;
        L.flash.intensity = f.v * 5;
      });
    this.ctx.audio.thunder(distance);
    if (distance < 0.4) this.ctx.ui.flash(0.12 * (1 - distance), 0.6);
  }

  /** Memory module corruption: screens break up, lights stutter, image tears. */
  async corrupt(signal?: AbortSignal): Promise<void> {
    const { audio, post } = this.ctx;
    this.view.mode = "corrupt";
    this.view.since = 0;
    audio.glitch(1);
    Object.values(this.room.consoleScreens).forEach((s) => gsap.to(s.noise, { value: 0.35, duration: 0.4 }));
    gsap.to(post.u.glitch, { value: 0.55, duration: 0.25 });
    for (let i = 0; i < 6; i++) {
      roomUniforms.ceiling.value = Math.random() < 0.5 ? 0.15 : 1;
      this.room.lights.ceiling.forEach((c) => (c.intensity = (roomUniforms.ceiling.value as number) * 16));
      if (i % 2 === 0) audio.lightFlicker();
      await wait(90 + Math.random() * 160, signal);
    }
    roomUniforms.ceiling.value = 0.8;
    this.room.lights.ceiling.forEach((c) => (c.intensity = 12));
    gsap.to(post.u.glitch, { value: 0.18, duration: 1.2 });
    await wait(900, signal);
  }

  clearCorruption(): void {
    const { post } = this.ctx;
    gsap.to(post.u.glitch, { value: 0, duration: 0.8 });
    Object.values(this.room.consoleScreens).forEach((s) => gsap.to(s.noise, { value: 0, duration: 0.8 }));
  }

  /** State after memory restoration (return from the memory room). */
  setCalm(): void {
    const L = this.room.lights;
    this.powered = true;
    this.emergencyOn = 0;
    roomUniforms.power.value = 1;
    roomUniforms.ceiling.value = 1;
    roomUniforms.racks.value = 1;
    roomUniforms.standby.value = 0;
    cityUniforms.powerRadius.value = 4000;
    cityUniforms.brightness.value = 1;
    skyUniforms.glow.value = 0.7;
    rainUniforms.intensity.value = 0.45;
    rainUniforms.wind.value = 0.12;
    rainUniforms.brightness.value = 0.8;
    glassUniforms.storm.value = 0;
    glassUniforms.rain.value = 0.5;
    glassUniforms.reflection.value = 0.18;
    this.fogDensity.value = 0.0005;
    this.stormLevel = 0;
    this.scene.environment = this.envPowered;
    this.scene.environmentIntensity = 0.9;
    L.ceiling.forEach((c) => (c.intensity = 12));
    L.ambient.intensity = 0.5;
    L.console.intensity = 1.8;
    L.city.intensity = 1.2;
    L.flash.intensity = 0;
    this.signal.u.visible.value = 0;
    this.signalLight = 0;
    this.signalAudio.level = 0;
    this.view.mode = "calm";
    this.view.since = 0;
    Object.values(this.room.consoleScreens).forEach((s) => {
      s.power.value = 1;
      s.noise.value = 0;
    });
    this.room.breaker.cover.rotation.x = -1.75;
    this.room.breaker.lever.rotation.x = 2.6;
    this.refreshShadows();
  }

  setDoor(state: DoorView["state"], name = ""): void {
    if (state === "unknown") {
      gsap.to(this.room.lights.doorWash, { intensity: 9, duration: 2.5 });
      gsap.to(this.room.doorScreen.brightness, { value: 1, duration: 1 });
    }
    this.door.state = state;
    this.door.since = 0;
    if (name) this.door.name = name;
  }

  /** Lighting warms up after the name is entered; the hidden room glows behind the door. */
  warmUp(): void {
    const L = this.room.lights;
    const c = roomUniforms.ceilingColor.value as THREE.Color;
    gsap.to(c, { r: 1.0, g: 0.76, b: 0.52, duration: 3 });
    L.ceiling.forEach((s) => {
      gsap.to(s.color, { r: 1.0, g: 0.78, b: 0.55, duration: 3 });
      gsap.to(s, { intensity: 11, duration: 3 });
    });
    this.scene.environment = this.envWarm;
    gsap.to(L.door, { intensity: 3, duration: 3 });
    gsap.to(roomUniforms.doorGlow, { value: 0.25, duration: 3 });
    this.applyAmbience("warm");
  }

  async openDoor(signal?: AbortSignal): Promise<void> {
    const { audio } = this.ctx;
    this.setDoor("open");
    audio.doorUnlock();
    await wait(600, signal);
    audio.doorSlide();
    gsap.to(roomUniforms.doorGlow, { value: 1, duration: 2.2 });
    gsap.to(this.room.lights.door, { intensity: 9, duration: 2.2 });
    await new Promise<void>((resolve) => gsap.to(this.room.doorLeaf.position, { z: DOOR.z + DOOR.w + 0.05, duration: 2.2, ease: "power2.inOut", onComplete: resolve }));
    this.refreshShadows();
  }

  refreshShadows(): void {
    for (const l of this.room.lights.ceiling) if (l.castShadow) l.shadow.needsUpdate = true;
  }

  /** Live-adjustable quality parameters (geometry counts apply up to what was allocated). */
  applyQuality(q: import("../../performance/Quality").QualityProfile): void {
    this.rain.count = q.rainCount;
    this.splashes.count = Math.floor(q.rainCount / 12);
    for (const s of this.room.lights.ceiling) {
      if (s.shadow && s.castShadow !== q.shadows && s === this.room.lights.ceiling[0]) {
        s.castShadow = q.shadows;
        s.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        s.shadow.map?.dispose();
        (s.shadow as unknown as { map: null }).map = null;
      }
    }
    this.refreshShadows();
  }

  // ------------------------------------------------------------------ frame update

  update(dt: number, t: number): void {
    if (!this.active) return;
    const { audio, cameras } = this.ctx;
    const cam = cameras.camera;

    // Emergency beacon: slow red breathing while offline.
    const em = this.emergencyOn * (0.25 + 0.75 * Math.pow(Math.sin(t * 1.4) * 0.5 + 0.5, 2));
    this.emergencyU.value = em;
    this.room.lights.emergency.intensity = em * 4.5;

    // Leak drip: fall + synced sound.
    this.dripT += dt;
    const fallTime = 0.62;
    const hang = this.dripPeriod - fallTime;
    const d = this.room.drip;
    if (this.dripT < hang) {
      const k = this.dripT / hang;
      d.position.y = ROOM.height - 0.07;
      d.scale.set(0.6 + k * 0.4, 0.8 + k * 1.2, 0.6 + k * 0.4);
    } else {
      const f = (this.dripT - hang) / fallTime;
      d.position.y = ROOM.height - 0.07 - f * f * (ROOM.height - 0.07);
      d.scale.set(0.8, 2.2, 0.8);
    }
    d.position.x = LEAK.x;
    d.position.z = LEAK.z;
    if (this.dripT >= this.dripPeriod) {
      this.dripT = 0;
      this.dripPeriod = 1.8 + Math.random() * 1.4;
      const dist = cam.position.distanceTo(d.position);
      if (dist < 9) audio.dripNow();
    }

    // Lightning during the storm.
    if (this.stormLevel > 0) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + Math.random() * 8;
        this.strike(0.35 + Math.random() * 0.6);
      }
    } else {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 18 + Math.random() * 20;
        this.strike(0.85);
      }
    }

    // Signal
    this.signal.update(t, cam, this.signalLight * 3);
    this.view.gate = this.signal.gateValue;
    if (this.signalAudio.level > 0 && this.signal.gateValue !== this.lastGate) {
      audio.signalGate(this.signal.gateValue);
    }
    this.lastGate = this.signal.gateValue;
    // Only re-target the signal layer when its level/pan meaningfully changes.
    const lvl = Math.round(this.signalAudio.level * (this.signal.u.visible.value as number) * 50) / 50;
    if (lvl !== this.lastSignalLevel || this.signalAudio.pan !== this.lastSignalPan) {
      this.lastSignalLevel = lvl;
      this.lastSignalPan = this.signalAudio.pan;
      audio.setSignal(lvl, this.signalAudio.pan, this.signalAudio.pitch);
    }

    // Scope history
    this.scopeAcc += dt;
    if (this.scopeAcc > 1 / 30) {
      this.scopeAcc = 0;
      this.view.scope.shift();
      this.view.scope.push(this.signal.gateValue * (0.85 + Math.random() * 0.15));
    }

    // Screens
    this.view.since += dt;
    this.door.since += dt;
    this.view.rain = rainUniforms.intensity.value as number;
    this.view.wind = rainUniforms.wind.value as number;
    if (this.screensEnabled) {
      for (const s of Object.values(this.room.consoleScreens)) if ((s.power.value as number) > 0.01) s.update(dt);
      this.room.doorScreen.update(dt);
    }
  }

  beforeRender(): void {
    if (!this.active || !this.reflection) return;
    // Only when the floor can actually be seen.
    const cam = this.ctx.cameras.camera;
    if (cam.position.x > ROOM.x1 + 0.5) return;
    this.reflection.update(this.scene, cam, [this.room.floor, ...this.room.glass, this.rain, this.splashes]);
  }

  dispose(): void {
    this.flickerTween?.kill();
    super.dispose();
  }
}

function L_dim(lights: THREE.SpotLight[], k: number): void {
  lights.forEach((l) => gsap.to(l, { intensity: l.intensity * k, duration: 3 }));
}
