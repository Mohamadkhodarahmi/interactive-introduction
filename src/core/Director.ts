import gsap from "gsap";
import * as THREE from "three/webgpu";
import type { AppContext } from "./AppContext";
import { wait } from "./Timeline";
import type { ObservationScene } from "../scenes/observation/ObservationScene";
import type { MemoryScene } from "../scenes/memory/MemoryScene";
import type { FinalScene } from "../scenes/final/FinalScene";
import type { SignalChoice } from "../state/ExperienceState";
import { CREATOR } from "../config";

const loadMemory = () => import("../scenes/memory/MemoryScene");
const loadFinal = () => import("../scenes/final/FinalScene");

/** Colour grades per story beat (display-space lift/gain). */
const GRADES = {
  offline: { exposure: 0.95, lift: new THREE.Color(0.0, 0.004, 0.012), gain: new THREE.Color(0.94, 0.98, 1.04), saturation: 0.82, bloom: 0.9, vignette: 0.42 },
  powered: { exposure: 1.0, lift: new THREE.Color(0.0, 0.003, 0.008), gain: new THREE.Color(1.0, 0.99, 1.0), saturation: 0.92, bloom: 0.8, vignette: 0.36 },
  storm: { exposure: 1.0, lift: new THREE.Color(0.0, 0.004, 0.014), gain: new THREE.Color(0.93, 0.98, 1.06), saturation: 0.8, bloom: 0.9, vignette: 0.45 },
  quiet: { exposure: 0.9, lift: new THREE.Color(0.0, 0.002, 0.008), gain: new THREE.Color(0.95, 0.97, 1.0), saturation: 0.75, bloom: 0.7, vignette: 0.5 },
  warm: { exposure: 1.02, lift: new THREE.Color(0.01, 0.004, 0.0), gain: new THREE.Color(1.06, 1.0, 0.92), saturation: 0.95, bloom: 0.8, vignette: 0.38 },
};

type GradeName = keyof typeof GRADES;

/**
 * The story, as one readable async script. Every beat reads/writes the
 * ExperienceStore; scenes only expose visual primitives.
 */
export class Director {
  private memory: MemoryScene | null = null;
  private final: FinalScene | null = null;

  constructor(private ctx: AppContext, private obs: ObservationScene) {}

  grade(name: GradeName, duration = 2.5): void {
    const g = GRADES[name];
    const u = this.ctx.post.u;
    gsap.to(u.exposure, { value: g.exposure, duration });
    gsap.to(u.saturation, { value: g.saturation, duration });
    gsap.to(u.bloom, { value: g.bloom, duration });
    gsap.to(u.vignette, { value: g.vignette, duration });
    gsap.to(u.lift.value as THREE.Color, { r: g.lift.r, g: g.lift.g, b: g.lift.b, duration });
    gsap.to(u.gain.value as THREE.Color, { r: g.gain.r, g: g.gain.g, b: g.gain.b, duration });
  }

  private fade(to: number, duration: number): Promise<void> {
    return new Promise((resolve) => gsap.to(this.ctx.post.u.fade, { value: to, duration, ease: "power2.inOut", onComplete: resolve }));
  }

  /** Dispose lazily-created scenes (used on replay). */
  /**
   * On replay the lazily-built scenes are kept and simply re-entered (their
   * enter() resets them). Disposing them here shared TSL uniform nodes with the
   * observation scene, which left the WebGPU backend rendering black after replay.
   */
  resetExtraScenes(): void {
    this.memory?.exit();
    this.final?.exit();
  }

  /** Full teardown (page unload / never needed for replay). */
  disposeExtraScenes(): void {
    this.memory?.dispose();
    this.final?.dispose();
    this.memory = null;
    this.final = null;
  }

  async run(signal: AbortSignal): Promise<void> {
    const { ui, store, audio, cameras, interactor, assets } = this.ctx;
    const obs = this.obs;
    ui.signal = signal;

    // ================================================================ SCENE 0 — ARRIVAL
    store.set({ currentScene: "arrival" });
    obs.resetLook();
    obs.enter();
    cameras.set("observationRoom");
    this.grade("offline", 0.01);
    interactor.enabled = true;
    const optional = this.bindOptionalInteractions();

    this.fade(0, 3.5);
    await ui.revealStage(2200);
    await wait(1800, signal);
    ui.systemHead("OBS-07 / CORE");
    await ui.system("SYSTEM OFFLINE", "bad");
    await wait(900, signal);
    await ui.system("3 MODULES UNAVAILABLE", "warn", { fadePrev: false });
    ui.setModules(0);
    await wait(900, signal);
    await ui.say("یه چیزی اینجا درست کار نمی‌کنه.");
    await ui.say("کمکم می‌کنی؟", { keep: true });
    await ui.button("شروع");
    // (audio was unlocked synchronously inside the click)
    store.set({ started: true });
    ui.showCorner(true);
    ui.clearSay();
    obs.applyAmbience("offline");
    audio.setPad("offline", 0.5, 5);
    store.completeScene("arrival");

    // ================================================================ SCENE 1 — POWER
    store.set({ currentScene: "power" });
    ui.hideShade();
    await ui.system("LOCATE MAIN BUS 07 — MANUAL RESET", "warn");
    obs.standby();
    // Narrow portrait screens can't see the breaker from the arrival framing.
    if (cameras.aspect < 0.9) cameras.goTo("consoleWide", { duration: 3.5 }).catch(() => undefined);
    const breakerPrompt = performance.now();
    await new Promise<void>((resolve) => {
      let hinted = false;
      const hintTimer = window.setTimeout(() => {
        hinted = true;
        ui.hint(obs.breakerAnchor);
      }, 9000);
      const nudge = window.setTimeout(() => {
        // Gently turn toward the console if the user seems lost.
        if (!signal.aborted) cameras.goTo("console", { duration: 3.5 }).catch(() => undefined);
      }, 20000);
      signal.addEventListener("abort", () => {
        clearTimeout(hintTimer);
        clearTimeout(nudge);
      });
      interactor.setEnabled("breaker", true);
      optional.breaker = () => {
        clearTimeout(hintTimer);
        clearTimeout(nudge);
        interactor.setEnabled("breaker", false);
        ui.hint(null);
        store.recordReaction(performance.now() - breakerPrompt);
        void hinted;
        resolve();
      };
    });
    audio.click();
    await cameras.goTo("console", { duration: 1.5, ease: "power2.inOut" });
    await obs.throwBreaker();
    cameras.goTo("observationRoom", { duration: 5.5, ease: "power2.inOut" });
    await obs.restorePower(signal);
    this.grade("powered", 3);
    audio.setPad("power", 0.45, 4);
    ui.systemClear();
    await ui.system("POWER RESTORED", "ok");
    await ui.system("1 / 3", "ok", { fadePrev: false });
    ui.setModules(1);
    audio.confirm();
    obs.bootComplete();
    await ui.say("خب... حداقل چراغ‌ها برگشتن.");
    store.set({ powerRestored: true });
    store.completeScene("power");

    // Prefetch the next environment while the user is busy with the signal.
    assets.prefetch("memory", loadMemory);

    // ================================================================ SCENE 2 — SIGNAL
    store.set({ currentScene: "signal" });
    await wait(1600, signal);
    audio.setPad("signal", 0.4, 5);
    await obs.revealSignal(signal);
    cameras.goTo("signal", { duration: 3.8, ease: "power2.inOut" });
    await ui.system("UNKNOWN SIGNAL DETECTED", "warn");
    await wait(1200, signal);
    await ui.say("اون نور رو می‌بینی؟", { keep: true });
    const choice = await ui.choose<SignalChoice>([
      { id: "approach", label: "نزدیک‌تر بشیم", key: "A" },
      { id: "investigate", label: "اول بررسیش کنیم", key: "B" },
      { id: "ignore", label: "بی‌خیالش...", key: "C" },
    ]);
    store.set({ signalChoice: choice, signalFound: true });
    obs.view.choice = choice;
    await ui.clearSay();
    ui.hideShade();

    if (choice === "approach") {
      this.grade("storm", 4);
      const move = obs.approach(signal);
      await wait(1200, signal);
      await ui.say("بریم ببینیم چیه.");
      await move;
      await ui.system("SIGNAL STRENGTH 340%", "warn");
      await ui.say("هرچی نزدیک‌تر میشیم، قوی‌تر میشه.");
      obs.strike(0.2);
      await wait(600, signal);
      await ui.say("انگار... داره جواب میده.");
    } else if (choice === "investigate") {
      const scan = obs.investigate(signal);
      await wait(900, signal);
      await ui.say("بذار اول ببینیم چی داره می‌فرسته.");
      await ui.system("RECONSTRUCTING SIGNAL", "");
      await scan;
      await ui.say("داره یه چیزی رو تکرار می‌کنه...");
      await ui.system("DECODING LAST GROUP", "warn");
    } else {
      await ui.say("باشه... بی‌خیالش.");
      this.grade("quiet", 4);
      await obs.ignoreSignal(signal, async () => {
        await ui.system("SIGNAL LOST", "");
      });
      this.grade("powered", 1);
      await ui.system("SIGNAL — 12 M", "bad");
      await ui.say("...ولی انگار اون بی‌خیال ما نمی‌شه.");
    }
    ui.setModules(2);
    audio.confirm();
    await ui.system("SIGNAL LOCKED  2 / 3", "ok");
    store.completeScene("signal");

    // ================================================================ SCENE 3 — MEMORY
    store.set({ currentScene: "memory" });
    await wait(700, signal);
    ui.systemClear();
    const corruption = obs.corrupt(signal);
    await ui.system("MEMORY MODULE", "bad");
    await ui.system("CORRUPTED", "bad", { fadePrev: false });
    await corruption;
    await ui.say("یه قسمت از حافظه‌م پاک شده.");

    audio.whoosh(2.2);
    await this.fade(1, 1.6);
    ui.systemClear();

    // Build + warm the memory room while the screen is black, so it never
    // stutters once visible. Degrade gracefully if it fails.
    let memory: MemoryScene | null = null;
    try {
      const mod = await assets.module("memory", loadMemory);
      memory = this.memory ?? new mod.MemoryScene(this.ctx);
      if (!this.memory) {
        this.memory = memory;
        await memory.preload();
        await memory.warm();
      }
    } catch (err) {
      console.warn("[director] memory scene unavailable", err);
      memory = null;
    }
    assets.prefetch("final", loadFinal);
    obs.clearCorruption();
    obs.exit();
    interactor.clear();
    if (memory) {
      memory.enter();
      this.fade(0, 2.5);
      await memory.play(signal);
      await this.fade(1, 2.2);
      memory.exit();
    } else {
      // Fallback: restore memory through dialogue only.
      await wait(1200, signal);
      await ui.say("بذار از اول بسازمش...");
      await ui.button("بازیابی حافظه");
    }
    store.set({ memoryRestored: true });
    store.completeScene("memory");

    // ================================================================ SCENE 4 — ANALYSIS
    store.set({ currentScene: "analysis" });
    obs.enter();
    obs.setCalm();
    this.bindOptionalInteractions(optional);
    cameras.set("observationRoom");
    this.grade("quiet", 0.01);
    obs.applyAmbience("quiet");
    audio.setPad("analysis", 0.35, 4);
    ui.systemClear();
    ui.setModules(3);
    ui.systemHead("OBS-07 / CORE");
    await this.fade(0, 2.6);
    await ui.system("MEMORY RESTORED  3 / 3", "ok");
    audio.confirm();
    await wait(1800, signal);
    await ui.system("ANALYZING USER", "warn");
    audio.scan();
    cameras.goTo("identity", { duration: 6, ease: "power1.inOut" });
    await wait(2600, signal);
    const decision = await this.ctx.decisions.chooseNextAction({ kind: "analyzeUser", state: store.get(), metrics: store.metrics });
    store.set({ interactionStyle: decision.action });
    await ui.say("جالبه...");
    await ui.say(decision.line, { hold: 600 });
    store.completeScene("analysis");

    // ================================================================ SCENE 5 — IDENTITY
    store.set({ currentScene: "identity" });
    obs.setDoor("unknown");
    this.grade("powered", 3);
    await ui.system("UNKNOWN USER", "bad");
    await ui.say("یه چیز دیگه مونده.");
    await wait(900, signal);
    await ui.say("اسم کسی که اینجا رو نجات داده رو نمی‌دونم.", { keep: true });
    const name = await ui.askName("اسمت چیه؟", "اسمت رو اینجا بنویس...", "ادامه", store.rememberedName());
    await ui.clearSay();
    store.saveName(name);
    obs.view.name = name;
    obs.setDoor("scanning");
    audio.scan();
    await wait(1700, signal);
    obs.setDoor("welcome", name);
    audio.confirm();
    await ui.system(`USER — ${name.toUpperCase()}`, "warm");
    obs.warmUp();
    this.grade("warm", 4);
    audio.setPad("identity", 0.45, 4);
    await ui.say("خب، {name}...", { hold: 400 }, { name });
    store.completeScene("identity");

    // Door: tap to enter (or it opens by itself after a while).
    assets.prefetch("final", loadFinal);
    await wait(600, signal);
    await new Promise<void>((resolve) => {
      ui.hint(obs.doorAnchor);
      const auto = window.setTimeout(done, 9000);
      function done() {
        clearTimeout(auto);
        resolve();
      }
      optional.door = () => {
        audio.click();
        done();
      };
      signal.addEventListener("abort", () => clearTimeout(auto));
    });
    optional.door = null;
    ui.hint(null);
    await obs.openDoor(signal);

    // ================================================================ SCENE 6 — FINAL ROOM
    store.set({ currentScene: "final" });
    audio.whoosh(2.8);
    cameras.goTo("reveal", { duration: 3.4, ease: "power2.in" });
    await wait(1800, signal);
    this.ctx.post.u.fadeColor.value.setRGB(0.06, 0.035, 0.02);
    await this.fade(1, 1.4);
    let final: FinalScene | null = null;
    try {
      const mod = await assets.module("final", loadFinal);
      final = this.final ?? new mod.FinalScene(this.ctx);
      if (!this.final) {
        this.final = final;
        await final.preload();
        await final.warm();
      }
    } catch (err) {
      console.warn("[director] final scene unavailable", err);
    }
    obs.exit();
    interactor.clear();
    ui.systemClear();
    ui.systemHead("", false);
    ui.setModules(3, false);

    if (final) {
      final.enter();
      audio.setMuffle(0.55, 2);
      audio.setRain(0.35, 0, 2);
      audio.setHum(0, 2);
      audio.setCity(0.15, 2);
      await this.fade(0, 3.2);
      this.ctx.post.u.fadeColor.value.setRGB(0.012, 0.016, 0.02);
      const walk = final.walkIn();
      await wait(1500, signal);
      await ui.say("فکر کنم وقتشه بدونی اینجا واقعاً چیه.", { hold: 400 });
      await walk;
      audio.setPad("silent", 0, 3);
      await wait(1600, signal);
      await final.laptopOn(signal);
    } else {
      this.fade(0, 1.5);
      await ui.say("فکر کنم وقتشه بدونی اینجا واقعاً چیه.");
    }
    store.completeScene("final");

    // ================================================================ CREATOR REVEAL
    store.set({ currentScene: "reveal" });
    audio.setPad("final", 0.4, 6);
    await ui.say("خب... حالا نوبت منه.");
    await ui.say("من {creator} هستم.", { hold: 300 }, { creator: CREATOR.name });
    await ui.say("می‌تونستم خیلی ساده بگم «سلام، خوبی؟»");
    final?.showHello();
    await wait(1400, signal);
    await ui.say("ولی فکر کردم این جالب‌تر باشه.", { hold: 800 });
    store.completeScene("reveal");

    // ================================================================ CONTACT
    store.set({ currentScene: "contact" });
    await ui.say("اگه این چند دقیقه برات جالب بود...");
    await ui.say("می‌تونیم مرحله بعدیش رو بیرون از اینجا ادامه بدیم :)", { keep: true });
    const contact = await ui.choose(
      [
        { id: "mine", label: "راه ارتباطی من" },
        { id: "yours", label: "راه ارتباطی خودم رو بذارم" },
      ],
      { column: true },
    );
    await ui.clearSay();
    if (contact === "mine") {
      await ui.contactCard(CREATOR.contacts, "ادامه");
    } else {
      await ui.say("اختیاریه :) اگه راحت نیستی، لازم نیست چیزی بذاری.", { keep: true });
      const left = await ui.contactForm("", "تلگرام، اینستاگرام، ایمیل... هر چی راحتی", "بفرست", "رد شدن");
      await ui.clearSay();
      if (left) {
        const sent = await this.deliverContact(name, left);
        audio.confirm();
        await ui.say(sent ? "رسید. ممنون :)" : "ذخیره شد، ولی الان نرسید... ممنون که گذاشتی :)");
      }
    }
    store.completeScene("contact");

    // ================================================================ FINAL STATE
    store.set({ currentScene: "end" });
    await ui.say("خب... مأموریت انجام شد.");
    await ui.say("مرسی که تا آخرش اومدی :)", { keep: true });
    await ui.finale("دوباره شروع کن", CREATOR.github ? { label: "GITHUB", href: CREATOR.github } : undefined);
  }

  /**
   * Visitor contact: POSTed as JSON to `CREATOR.inbox.endpoint` when configured
   * (Formspree, a Telegram-bot worker, etc.). Always also kept on the device so
   * nothing is lost if the request fails; optional mail draft as a last resort.
   */
  private async deliverContact(name: string, contact: string): Promise<boolean> {
    const st = this.ctx.store.get();
    const payload = {
      name,
      contact,
      signalChoice: st.signalChoice,
      interactionStyle: st.interactionStyle,
      at: new Date().toISOString(),
    };
    try {
      localStorage.setItem("unknown-system:contact", JSON.stringify(payload));
    } catch {
      /* ignore */
    }
    const { endpoint, email } = CREATOR.inbox;
    if (endpoint) {
      try {
        const ctl = new AbortController();
        const timer = window.setTimeout(() => ctl.abort(), 8000);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (res.ok) return true;
      } catch (err) {
        console.warn("[contact] send failed", err);
      }
    }
    if (email) {
      const body = encodeURIComponent(`${name}\n${contact}`);
      window.open(`mailto:${email}?subject=${encodeURIComponent("UNKNOWN SYSTEM")}&body=${body}`, "_blank");
      return true;
    }
    return false;
  }

  /**
   * Optional interactions (explore the room). They feed the behaviour metrics
   * the analysis uses, and give small diegetic responses.
   */
  private bindOptionalInteractions(existing?: OptionalHandlers): OptionalHandlers {
    const { store, ui, audio } = this.ctx;
    const obs = this.obs;
    const h: OptionalHandlers = existing ?? { breaker: null, door: null };
    let lastLine = 0;
    const line = async (text: string, cls = "") => {
      if (performance.now() - lastLine < 2500) return;
      lastLine = performance.now();
      await ui.system(text, cls, { fadePrev: true }).catch(() => undefined);
    };
    obs.registerHotspots({
      breaker: () => h.breaker?.(),
      window: () => {
        const s = store.get();
        if (!s.started) return;
        audio.click();
        if (!s.exploredWindow) store.set({ exploredWindow: true });
        store.recordOptional();
        obs.strike(0.7);
        line(`EXTERIOR — RAIN ${(12 + Math.random() * 6).toFixed(1)} MM/H`);
      },
      screens: () => {
        const s = store.get();
        if (!s.started) return;
        audio.click();
        if (!s.inspectedConsole) store.set({ inspectedConsole: true });
        store.recordOptional();
        if (!s.powerRestored) {
          obs.standby();
          line("CONSOLE — NO POWER", "bad");
        } else line("CONSOLE — NOMINAL", "ok");
      },
      racks: () => {
        if (!store.get().started) return;
        audio.click();
        store.recordOptional();
        line(store.get().powerRestored ? "ARCHIVE — READ ONLY" : "ARCHIVE — OFFLINE", "");
      },
      door: () => {
        const s = store.get();
        if (!s.started) return;
        if (h.door) return h.door();
        store.metrics.doorAttempts++;
        store.recordOptional();
        audio.deny();
        obs.flashDoor("denied");
        line("ACCESS DENIED — IDENTITY REQUIRED", "bad");
      },
    });
    return h;
  }
}

interface OptionalHandlers {
  breaker: (() => void) | null;
  door: (() => void) | null;
}
