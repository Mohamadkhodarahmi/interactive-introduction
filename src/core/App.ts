import * as THREE from "three/webgpu";
import gsap from "gsap";
import { createRenderer } from "./Renderer";
import type { AppContext } from "./AppContext";
import { CameraManager } from "../camera/CameraManager";
import { AudioEngine } from "../audio/AudioEngine";
import { UI } from "../ui/UI";
import { ExperienceStore } from "../state/ExperienceState";
import { LocalDecisionProvider } from "../state/decisions";
import { Interactor } from "../interactions/Interactor";
import { PostFX } from "../rendering/PostFX";
import { AssetManager } from "../assets/AssetManager";
import { PROFILES, detectQuality, storeQuality, type QualityLevel } from "../performance/Quality";
import { AdaptiveDpr } from "../performance/AdaptiveDpr";
import { ObservationScene } from "../scenes/observation/ObservationScene";
import { Director } from "./Director";
import { Aborted } from "./Timeline";
import type { BaseScene } from "./BaseScene";

/**
 * Boots the renderer and systems, owns the frame loop and the replay cycle.
 */
export class App {
  private ctx!: AppContext;
  private dpr!: AdaptiveDpr;
  private clock = new THREE.Timer();
  private scenes: BaseScene[] = [];
  private obs!: ObservationScene;
  private director!: Director;
  private abort: AbortController | null = null;
  private elapsed = 0;
  private statTimer = 0;
  private qualityChoice: QualityLevel | "auto" = "auto";

  async start(): Promise<void> {
    const ui = new UI();
    const assets = new AssetManager();
    ui.setProgress(0.1);

    let rendererInfo;
    try {
      rendererInfo = await createRenderer(document.getElementById("stage")!);
    } catch (err) {
      console.error(err);
      ui.fatal("RENDERER UNAVAILABLE", "مرورگرت نتونست گرافیک سه‌بعدی رو اجرا کنه. با یه مرورگر به‌روز (کروم یا سافاری) دوباره امتحان کن.");
      return;
    }
    const { renderer, isWebGPU } = rendererInfo;
    ui.setProgress(0.3);

    try {
      const stored = localStorage.getItem("unknown-system:quality");
      if (stored === "low" || stored === "medium" || stored === "high") this.qualityChoice = stored;
    } catch {
      /* ignore */
    }
    const level = detectQuality(isWebGPU);
    const profile = { ...PROFILES[level] };

    const cameras = new CameraManager();
    const interactor = new Interactor(renderer.domElement, cameras.camera);
    const audio = new AudioEngine();
    const store = new ExperienceStore();
    const placeholder = new THREE.Scene();
    const post = new PostFX(renderer, placeholder, cameras.camera, profile);

    this.ctx = { renderer, isWebGPU, cameras, audio, ui, store, decisions: new LocalDecisionProvider(), interactor, post, assets, quality: profile };

    this.dpr = new AdaptiveDpr(profile.minDpr, profile.maxDpr, (d) => {
      renderer.setPixelRatio(d);
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    renderer.setPixelRatio(this.dpr.current);

    // --- input wiring
    interactor.onLook = (dx, dy) => cameras.addLook(dx, dy);
    interactor.onLookDistance = (d) => (store.metrics.lookDistance += d);
    ui.onClick = () => {
      // First user gesture unlocks audio (must stay synchronous inside the click).
      audio.unlock();
      audio.click();
    };
    ui.onType = () => audio.tick();
    ui.onReaction = (ms) => store.recordReaction(ms);
    ui.onMute = (m) => {
      audio.setMuted(m);
      try {
        localStorage.setItem("unknown-system:muted", m ? "1" : "0");
      } catch {
        /* ignore */
      }
    };
    try {
      if (localStorage.getItem("unknown-system:muted") === "1") {
        audio.setMuted(true);
        ui.setMuted(true);
      }
    } catch {
      /* ignore */
    }
    ui.onQuality = (q) => this.setQuality(q);
    const motionAvailable = typeof DeviceOrientationEvent !== "undefined" && matchMedia("(pointer: coarse)").matches;
    ui.onMotion = () => this.enableMotion();
    ui.buildMenu(this.qualityChoice, motionAvailable);

    // --- first scene (built procedurally, no downloads)
    const fontLoad = assets.fonts();
    this.obs = new ObservationScene(this.ctx);
    this.scenes.push(this.obs);
    ui.setProgress(0.45);
    try {
      await this.obs.preload();
    } catch (err) {
      console.error(err);
      ui.fatal("SCENE FAILED", "یه مشکلی تو ساختن صحنه پیش اومد. صفحه رو دوباره باز کن.");
      return;
    }
    ui.setProgress(0.9);
    await fontLoad;
    ui.setProgress(1);

    this.director = new Director(this.ctx, this.obs);
    window.addEventListener("resize", this.onResize);
    window.visualViewport?.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.onResize();

    this.clock.connect(document);
    renderer.setAnimationLoop(this.frame);
    (window as unknown as { __app: unknown }).__app = { ctx: this.ctx, app: this };
    this.dpr.grace(4000);
    const debug = new URLSearchParams(location.search).get("debug");
    if (import.meta.env.DEV && debug) this.debugSetup(debug);
    else this.play();
  }

  private play(): void {
    this.abort?.abort();
    const ctl = new AbortController();
    this.abort = ctl;
    this.director
      .run(ctl.signal)
      .then(() => this.replay())
      .catch((err) => {
        if (err instanceof Aborted) return;
        console.error("[director]", err);
      });
  }

  /** Full reset: state, audio, UI, lazily-created scenes. */
  private async replay(): Promise<void> {
    const { ui, store, audio, post, interactor } = this.ctx;
    this.abort?.abort();
    audio.whoosh(1.4);
    await new Promise<void>((r) => gsap.to(post.u.fade, { value: 1, duration: 1.4, onComplete: r }));
    gsap.killTweensOf("*");
    ui.clearAll();
    ui.showCorner(false);
    interactor.clear();
    audio.reset();
    audio.setRain(0.4, 0);
    this.director.disposeExtraScenes();
    store.reset();
    post.u.glitch.value = 0;
    post.u.warp.value = 0;
    (post.u.fadeColor.value as THREE.Color).setRGB(0.012, 0.016, 0.02);
    this.play();
  }

  private frame = (): void => {
    this.clock.update();
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    this.elapsed += dt;
    const { cameras, ui, post, audio } = this.ctx;
    this.dpr.tick(dt);
    // Update every scene that is active (only one normally).
    const active = this.activeScenes();
    for (const s of active) s.update(dt, this.elapsed);
    cameras.update(dt, this.elapsed);
    cameras.camera.updateMatrixWorld();
    for (const s of active) s.beforeRender();
    ui.updateHint(cameras.camera);
    audio.update(dt);
    post.render();

    this.statTimer += dt;
    if (this.statTimer > 1) {
      this.statTimer = 0;
      const r = this.ctx.renderer as unknown as { info: { render: { drawCalls?: number; calls?: number } } };
      ui.setStat(`${this.ctx.isWebGPU ? "WEBGPU" : "WEBGL2"} · ${this.dpr.fps.toFixed(0)} FPS · DPR ${this.dpr.current.toFixed(2)} · ${this.ctx.quality.level.toUpperCase()}${r.info?.render?.drawCalls ? " · " + r.info.render.drawCalls + " DC" : ""}`);
    }
  };

  private activeScenes(): BaseScene[] {
    const list: BaseScene[] = [this.obs];
    const d = this.director as unknown as { memory: BaseScene | null; final: BaseScene | null };
    if (d.memory) list.push(d.memory);
    if (d.final) list.push(d.final);
    return list;
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.renderer.setSize(w, h);
    this.ctx.cameras.resize(w, h);
  };

  private onVisibility = (): void => {
    const ac = this.ctx.audio.ctx;
    if (!ac) return;
    if (document.hidden) ac.suspend().catch(() => undefined);
    else if (this.ctx.store.get().started) ac.resume().catch(() => undefined);
  };

  private setQuality(q: QualityLevel | "auto"): void {
    this.qualityChoice = q;
    storeQuality(q === "auto" ? null : q);
    const level = q === "auto" ? detectQuality(this.ctx.isWebGPU) : q;
    const next = PROFILES[level];
    Object.assign(this.ctx.quality, next);
    this.dpr.setRange(next.minDpr, next.maxDpr);
    this.ctx.post.setProfile(next);
    this.obs.applyQuality(next);
  }

  /** Dev-only: jump to a visual state, e.g. ?debug=calm&cam=window */
  private debugSetup(mode: string): void {
    const p = new URLSearchParams(location.search);
    const { ui, post, cameras } = this.ctx;
    ui.revealStage(10);
    post.u.fade.value = 0;
    this.obs.resetLook();
    this.obs.enter();
    if (mode === "calm" || mode === "warm") this.obs.setCalm();
    if (mode === "warm") this.obs.warmUp();
    if (mode === "signal") {
      this.obs.setCalm();
      this.obs.signal.u.visible.value = 1;
    }
    cameras.set(p.get("cam") ?? "observationRoom");
  }

  private async enableMotion(): Promise<void> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try {
      if (typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") return;
      }
    } catch {
      return;
    }
    let base: { b: number; g: number } | null = null;
    window.addEventListener("deviceorientation", (e) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      const x = THREE.MathUtils.clamp((e.gamma - base.g) / 25, -1, 1);
      const y = THREE.MathUtils.clamp((e.beta - base.b) / 25, -1, 1);
      this.ctx.cameras.setDeviceMotion(-x, -y);
    });
  }
}
