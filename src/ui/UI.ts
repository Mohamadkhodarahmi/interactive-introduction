import * as THREE from "three/webgpu";
import { abortable, wait } from "../core/Timeline";
import type { QualityLevel } from "../performance/Quality";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  parent?.appendChild(el);
  return el;
};

const ICONS = {
  sound:
    '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h3M11 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
};

export interface Choice<T extends string = string> {
  id: T;
  label: string;
  key?: string;
}

export interface SayOptions {
  /** Extra hold time after reading time (ms). */
  hold?: number;
  /** Keep the line on screen after resolving (clear with clearSay()). */
  keep?: boolean;
  /** Override the computed reading time (ms). */
  duration?: number;
}

export class UI {
  readonly root: HTMLElement;
  private shade: HTMLElement;
  private sysEl: HTMLElement;
  private sysHead: HTMLElement;
  private sysLines: HTMLElement;
  private modulesEl: HTMLElement;
  private dialog: HTMLElement;
  private sayEl: HTMLElement;
  private actions: HTMLElement;
  private hintEl: HTMLElement;
  private hintAnchor: THREE.Vector3 | null = null;
  private corner: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private menu: HTMLElement;
  private statEl: HTMLElement;
  private veil: HTMLElement;
  private bootBar: HTMLElement;
  private bootLabel: HTMLElement | null = null;
  private bootPct: HTMLElement | null = null;
  private flashEl: HTMLElement;
  private proj = new THREE.Vector3();
  signal?: AbortSignal;
  /** Called when a choice/button prompt resolves: ms from shown → acted. */
  onReaction: (ms: number) => void = () => undefined;
  onMute: (muted: boolean) => void = () => undefined;
  onQuality: (q: QualityLevel | "auto") => void = () => undefined;
  onMotion: () => void = () => undefined;
  /** Sound hook for UI feedback. */
  onClick: () => void = () => undefined;
  onType: () => void = () => undefined;

  constructor() {
    this.root = h("div");
    this.root.id = "ui";
    document.body.appendChild(this.root);

    this.shade = h("div", "shade", this.root);

    this.sysEl = h("div", "sys", this.root);
    this.sysEl.setAttribute("aria-live", "polite");
    this.sysHead = h("div", "head", this.sysEl);
    this.sysHead.textContent = "OBS-07 / CORE";
    this.sysLines = h("div", "", this.sysEl);
    this.modulesEl = h("div", "modules", this.sysEl);
    for (let i = 0; i < 3; i++) h("i", "", this.modulesEl);

    this.hintEl = h("div", "hint", this.root);
    h("div", "dot", this.hintEl);

    this.dialog = h("div", "dialog", this.root);
    this.sayEl = h("div", "say", this.dialog);
    this.sayEl.setAttribute("aria-live", "polite");
    this.actions = h("div", "actions", this.dialog);

    this.corner = h("div", "corner", this.root);
    const settingsBtn = h("button", "icon-btn", this.corner);
    settingsBtn.innerHTML = ICONS.settings;
    settingsBtn.setAttribute("aria-label", "Settings");
    this.muteBtn = h("button", "icon-btn", this.corner);
    this.muteBtn.innerHTML = ICONS.sound;
    this.muteBtn.setAttribute("aria-label", "Mute");
    this.muteBtn.addEventListener("click", () => {
      const muted = this.muteBtn.dataset.muted !== "1";
      this.setMuted(muted);
      this.onMute(muted);
    });

    this.menu = h("div", "menu interactive", this.root);
    settingsBtn.addEventListener("click", () => this.menu.classList.toggle("open"));
    this.statEl = h("div", "stat", this.menu);

    // The teaser loader is inline in index.html so it paints before the JS arrives.
    const loader = document.getElementById("loader");
    if (loader) {
      this.veil = loader;
      this.bootBar = loader.querySelector<HTMLElement>(".ld-bar i")!;
      this.bootLabel = loader.querySelector<HTMLElement>(".ld-label");
      this.bootPct = loader.querySelector<HTMLElement>(".ld-pct");
    } else {
      this.veil = h("div", "veil");
      document.body.appendChild(this.veil);
      const boot = h("div", "boot", this.veil);
      const bootLabel = h("div", "", boot);
      bootLabel.textContent = "establishing link";
      const bar = h("div", "bar", boot);
      this.bootBar = h("i", "", bar);
    }

    this.flashEl = h("div", "flash");
    document.body.appendChild(this.flashEl);

    document.addEventListener("pointerdown", (e) => {
      if (!this.menu.contains(e.target as Node) && !settingsBtn.contains(e.target as Node)) this.menu.classList.remove("open");
    });
  }

  // ------------------------------------------------------------ loading / veil

  setProgress(p: number, label?: string): void {
    const v = Math.max(0, Math.min(1, p));
    this.bootBar.style.transform = `scaleX(${v})`;
    if (this.bootPct) this.bootPct.textContent = `${Math.round(v * 100)}%`;
    if (label && this.bootLabel) this.bootLabel.textContent = label;
  }

  async revealStage(duration = 1600): Promise<void> {
    this.veil.style.transitionDuration = `${duration}ms`;
    this.veil.classList.add("hidden");
    this.veil.removeAttribute("aria-busy");
    await wait(duration);
    // Drop the teaser (images + endless CSS animations) so it costs nothing while playing.
    if (this.veil.classList.contains("loader")) {
      this.veil.classList.remove("loader");
      this.veil.innerHTML = "";
      this.bootLabel = this.bootPct = null;
    }
  }

  async veilIn(duration = 1200, color = "#030405"): Promise<void> {
    this.veil.innerHTML = "";
    this.veil.style.background = color;
    this.veil.style.transitionDuration = `${duration}ms`;
    this.veil.classList.remove("hidden");
    await wait(duration);
  }

  fatal(code: string, message: string): void {
    this.veil.innerHTML = "";
    this.veil.classList.remove("hidden");
    const box = h("div", "fatal", this.veil);
    const c = h("code", "", box);
    c.textContent = code;
    const p = h("div", "", box);
    p.textContent = message;
  }

  flash(strength = 0.5, duration = 0.5): void {
    this.flashEl.animate([{ opacity: strength }, { opacity: 0 }], { duration: duration * 1000, easing: "cubic-bezier(.1,.7,.3,1)" });
  }

  // ------------------------------------------------------------ system log

  systemHead(label: string, on = true): void {
    this.sysHead.textContent = label;
    this.sysHead.classList.toggle("on", on);
  }

  /** Type a system line. Resolves when typing finishes. */
  async system(text: string, cls = "", opts: { speed?: number; fadePrev?: boolean } = {}): Promise<HTMLElement> {
    const speed = opts.speed ?? 28;
    if (opts.fadePrev !== false) this.sysLines.querySelectorAll(".line").forEach((l) => l.classList.add("fade"));
    this.sysLines.querySelectorAll(".cursor").forEach((c) => c.remove());
    const line = h("div", `line ${cls}`, this.sysLines);
    const textNode = document.createTextNode("");
    line.appendChild(textNode);
    const cursor = h("span", "cursor", line);
    for (let i = 0; i < text.length; i++) {
      textNode.data = text.slice(0, i + 1);
      if (text[i] !== " " && i % 2 === 0) this.onType();
      await wait(speed + (Math.random() < 0.08 ? 60 : 0), this.signal);
    }
    // Keep at most 4 lines visible.
    const lines = this.sysLines.querySelectorAll(".line");
    if (lines.length > 4) lines[0].remove();
    void cursor;
    return line;
  }

  systemClear(): void {
    this.sysLines.innerHTML = "";
  }

  setModules(n: number, visible = true): void {
    this.modulesEl.classList.toggle("on", visible);
    this.modulesEl.querySelectorAll("i").forEach((el, i) => el.classList.toggle("on", i < n));
  }

  // ------------------------------------------------------------ subtitles

  private readingTime(text: string): number {
    return 1400 + text.length * 55;
  }

  /** Show a Persian line, word by word. `{name}` is highlighted. */
  async say(text: string, opts: SayOptions = {}, vars: Record<string, string> = {}): Promise<void> {
    await this.clearSay();
    this.shade.classList.add("on");
    const el = this.sayEl;
    el.classList.remove("out");
    el.innerHTML = "";
    const words = text.split(" ");
    const spans: HTMLElement[] = [];
    words.forEach((w, i) => {
      const m = /^(.*)\{(\w+)\}(.*)$/.exec(w);
      const span = h("span", "", el);
      if (m && vars[m[2]] !== undefined) {
        span.append(m[1]);
        const n = h("b", "name", span);
        n.textContent = vars[m[2]];
        span.append(m[3]);
      } else span.textContent = w;
      spans.push(span);
      if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
    });
    for (let i = 0; i < spans.length; i++) {
      spans[i].classList.add("in");
      await wait(90 + Math.min(140, spans[i].textContent!.length * 18), this.signal);
    }
    await wait((opts.duration ?? this.readingTime(text)) + (opts.hold ?? 0) - spans.length * 110, this.signal).catch((e) => {
      throw e;
    });
    if (!opts.keep) await this.clearSay();
  }

  async clearSay(): Promise<void> {
    if (!this.sayEl.childElementCount) return;
    this.sayEl.classList.add("out");
    await wait(550, this.signal);
    this.sayEl.innerHTML = "";
    this.sayEl.classList.remove("out");
  }

  hideShade(): void {
    this.shade.classList.remove("on");
  }

  // ------------------------------------------------------------ prompts

  private clearActions(): void {
    this.actions.innerHTML = "";
    this.actions.className = "actions";
  }

  private async showButtons(): Promise<void> {
    const btns = Array.from(this.actions.querySelectorAll<HTMLElement>(".btn, .field, .card"));
    for (const b of btns) {
      await wait(110);
      b.classList.add("in");
    }
  }

  private async resolveButtons(pressed: HTMLElement): Promise<void> {
    pressed.classList.add("pressed");
    this.onClick();
    this.actions.querySelectorAll<HTMLButtonElement>("button, input, textarea").forEach((b) => (b.disabled = true));
    await wait(380);
    this.actions.querySelectorAll<HTMLElement>(".btn, .field, .card").forEach((b) => b.classList.remove("in"));
    await wait(450);
    this.clearActions();
  }

  async choose<T extends string>(choices: Choice<T>[], opts: { column?: boolean } = {}): Promise<T> {
    this.clearActions();
    this.shade.classList.add("on");
    if (opts.column || (choices.length > 2 && window.innerWidth < 720)) this.actions.classList.add("column");
    const shownAt = performance.now();
    const p = new Promise<T>((resolve) => {
      for (const c of choices) {
        const b = h("button", "btn", this.actions);
        if (c.key) {
          const k = h("span", "k", b);
          k.textContent = c.key;
        }
        const s = h("span", "", b);
        s.textContent = c.label;
        b.addEventListener(
          "click",
          async () => {
            this.onReaction(performance.now() - shownAt);
            await this.resolveButtons(b);
            resolve(c.id);
          },
          { once: true },
        );
      }
    });
    await this.showButtons();
    return abortable(p, this.signal);
  }

  async button(label: string, cls = "primary"): Promise<void> {
    this.clearActions();
    this.shade.classList.add("on");
    const shownAt = performance.now();
    const b = h("button", `btn ${cls}`, this.actions);
    b.textContent = label;
    const p = new Promise<void>((resolve) =>
      b.addEventListener(
        "click",
        async () => {
          this.onReaction(performance.now() - shownAt);
          await this.resolveButtons(b);
          resolve();
        },
        { once: true },
      ),
    );
    await this.showButtons();
    return abortable(p, this.signal);
  }

  /** Name prompt. Returns a trimmed, non-empty name. */
  async askName(label: string, placeholder: string, cta: string, initial = ""): Promise<string> {
    this.clearActions();
    this.actions.classList.add("column");
    const field = h("div", "field", this.actions);
    const lab = h("label", "", field);
    lab.textContent = label;
    lab.htmlFor = "name-input";
    const input = h("input", "", field);
    input.id = "name-input";
    input.type = "text";
    input.maxLength = 32;
    input.autocomplete = "given-name";
    input.enterKeyHint = "done";
    input.placeholder = placeholder;
    input.value = initial;
    const b = h("button", "btn primary", this.actions);
    b.textContent = cta;
    const sync = () => (b.disabled = input.value.trim().length === 0);
    sync();
    input.addEventListener("input", sync);
    const p = new Promise<string>((resolve) => {
      const submit = async () => {
        const v = input.value.trim().replace(/\s+/g, " ");
        if (!v) return;
        input.blur();
        await this.resolveButtons(b);
        resolve(v);
      };
      b.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    });
    await this.showButtons();
    // Focusing opens the keyboard on mobile; only auto-focus on desktop.
    if (!matchMedia("(pointer: coarse)").matches) input.focus();
    return abortable(p, this.signal);
  }

  /**
   * Creator contact card. Each channel opens in a new tab/app; the card stays
   * so the visitor can come back and open another one. Resolves on `cta`.
   */
  async contactCard(items: { label: string; value: string; href: string }[], cta: string): Promise<void> {
    this.clearActions();
    this.actions.classList.add("column");
    const card = h("div", "card", this.actions);
    for (const it of items.filter((i) => i.value && i.href)) {
      const a = h("a", "", card);
      a.href = it.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const l = h("span", "", a);
      l.textContent = it.label;
      const v = h("span", "val", a);
      v.textContent = it.value;
      const arrow = h("span", "go", a);
      arrow.textContent = "↗";
      a.addEventListener("click", () => {
        this.onClick();
        a.classList.add("visited");
        arrow.textContent = "✓";
      });
    }
    const b = h("button", "btn", this.actions);
    b.textContent = cta;
    const p = new Promise<void>((resolve) => b.addEventListener("click", async () => (await this.resolveButtons(b), resolve()), { once: true }));
    await this.showButtons();
    return abortable(p, this.signal);
  }

  /** Final buttons: replay + optional link. Resolves on replay. */
  async finale(replay: string, link?: { label: string; href: string; caption?: string }): Promise<void> {
    this.clearActions();
    const b = h("button", "btn primary", this.actions);
    b.textContent = replay;
    if (link) {
      const a = h("a", "btn ghost", this.actions);
      a.textContent = link.label;
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.direction = "ltr";
      a.style.fontFamily = "var(--mono)";
      a.style.fontSize = "12px";
      a.style.letterSpacing = "0.14em";
      if (link.caption) {
        const c = h("a", "src-link", this.actions);
        c.textContent = link.caption;
        c.href = link.href;
        c.target = "_blank";
        c.rel = "noopener noreferrer";
      }
    }
    const p = new Promise<void>((resolve) => b.addEventListener("click", async () => (await this.resolveButtons(b), resolve()), { once: true }));
    await this.showButtons();
    return abortable(p, this.signal);
  }

  clearAll(): void {
    this.clearActions();
    this.sayEl.innerHTML = "";
    this.systemClear();
    this.setModules(0, false);
    this.systemHead("", false);
    this.hint(null);
    this.hideShade();
  }

  // ------------------------------------------------------------ hint ring

  hint(anchor: THREE.Vector3 | null): void {
    this.hintAnchor = anchor;
    this.hintEl.classList.toggle("on", Boolean(anchor));
  }

  updateHint(camera: THREE.Camera): void {
    if (!this.hintAnchor) return;
    this.proj.copy(this.hintAnchor).project(camera);
    const behind = this.proj.z > 1;
    const x = (this.proj.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.proj.y * 0.5 + 0.5) * window.innerHeight;
    this.hintEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    this.hintEl.style.visibility = behind ? "hidden" : "visible";
  }

  // ------------------------------------------------------------ settings

  showCorner(on = true): void {
    this.corner.classList.toggle("on", on);
  }

  setMuted(m: boolean): void {
    this.muteBtn.dataset.muted = m ? "1" : "0";
    this.muteBtn.innerHTML = m ? ICONS.muted : ICONS.sound;
    this.muteBtn.setAttribute("aria-label", m ? "Unmute" : "Mute");
  }

  buildMenu(current: QualityLevel | "auto", motionAvailable: boolean): void {
    this.menu.querySelectorAll(":scope > :not(.stat)").forEach((n) => n.remove());
    const title = h("div", "title");
    title.textContent = "Quality";
    this.menu.prepend(title);
    let anchor: Element = title;
    const add = (el: HTMLElement) => {
      anchor.after(el);
      anchor = el;
    };
    (["auto", "high", "medium", "low"] as const).forEach((q) => {
      const b = h("button", q === current ? "sel" : "");
      b.textContent = q;
      b.addEventListener("click", () => {
        this.onQuality(q);
        this.buildMenu(q, motionAvailable);
      });
      add(b);
    });
    if (motionAvailable) {
      add(h("div", "sep"));
      const b = h("button", "");
      b.textContent = "Device motion";
      b.addEventListener("click", () => {
        this.onMotion();
        b.classList.add("sel");
      });
      add(b);
    }
    add(h("div", "sep"));
  }

  setStat(text: string): void {
    this.statEl.textContent = text;
  }
}
