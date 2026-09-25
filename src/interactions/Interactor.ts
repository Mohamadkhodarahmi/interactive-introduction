import * as THREE from "three/webgpu";

export interface Hotspot {
  id: string;
  /** Objects that count as hits for this hotspot. */
  objects: THREE.Object3D[];
  onTap: () => void;
  enabled: boolean;
  /** World-space anchor for the optional on-screen hint ring. */
  anchor?: THREE.Vector3;
}

/**
 * Touch-first input. A pointer gesture is a *tap* if it moves less than a few
 * pixels and is short; otherwise it is a drag-to-look. Taps raycast against the
 * registered hotspots of the active scene. No hover-only behaviour: hover only
 * changes the cursor on devices that have one.
 */
export class Interactor {
  private hotspots: Hotspot[] = [];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number; t: number; id: number; lastX: number; lastY: number } | null = null;
  private dragging = false;
  enabled = true;
  lookEnabled = true;
  onLook: (dx: number, dy: number) => void = () => undefined;
  onLookDistance: (d: number) => void = () => undefined;
  /** Fired on taps that hit nothing (used for "tap anywhere" hints). */
  onMiss: () => void = () => undefined;

  constructor(private el: HTMLElement, private camera: THREE.Camera) {
    el.addEventListener("pointerdown", this.pointerDown);
    el.addEventListener("pointermove", this.pointerMove);
    el.addEventListener("pointerup", this.pointerUp);
    el.addEventListener("pointercancel", this.pointerCancel);
    el.style.touchAction = "none";
  }

  add(h: Hotspot): Hotspot {
    this.hotspots.push(h);
    return h;
  }

  remove(id: string): void {
    this.hotspots = this.hotspots.filter((h) => h.id !== id);
  }

  get(id: string): Hotspot | undefined {
    return this.hotspots.find((h) => h.id === id);
  }

  setEnabled(id: string, on: boolean): void {
    const h = this.get(id);
    if (h) h.enabled = on;
  }

  clear(): void {
    this.hotspots = [];
  }

  private pick(clientX: number, clientY: number): Hotspot | null {
    const rect = this.el.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    let best: { h: Hotspot; d: number } | null = null;
    for (const h of this.hotspots) {
      if (!h.enabled) continue;
      const hits = this.raycaster.intersectObjects(h.objects, true);
      if (hits.length && (!best || hits[0].distance < best.d)) best = { h, d: hits[0].distance };
    }
    // Forgiving touch: retry with small offsets so fingertips don't need pixel precision.
    if (!best && matchMedia("(pointer: coarse)").matches) {
      const r = 22;
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        this.ndc.set(((clientX + ox - rect.left) / rect.width) * 2 - 1, -((clientY + oy - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.camera);
        for (const h of this.hotspots) {
          if (!h.enabled) continue;
          if (this.raycaster.intersectObjects(h.objects, true).length) return h;
        }
      }
    }
    return best?.h ?? null;
  }

  private pointerDown = (e: PointerEvent): void => {
    if (!this.enabled || this.down) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    this.dragging = false;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private pointerMove = (e: PointerEvent): void => {
    if (!this.down) {
      if (e.pointerType === "mouse" && this.enabled) {
        this.el.style.cursor = this.pick(e.clientX, e.clientY) ? "pointer" : "default";
      }
      return;
    }
    if (e.pointerId !== this.down.id) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y);
    if (moved > 8) this.dragging = true;
    if (this.dragging && this.lookEnabled) {
      const s = Math.min(window.innerWidth, window.innerHeight);
      const dx = (e.clientX - this.down.lastX) / s;
      const dy = (e.clientY - this.down.lastY) / s;
      this.onLook(dx, dy);
      this.onLookDistance(Math.hypot(dx, dy));
    }
    this.down.lastX = e.clientX;
    this.down.lastY = e.clientY;
  };

  private pointerUp = (e: PointerEvent): void => {
    if (!this.down || e.pointerId !== this.down.id) return;
    const wasTap = !this.dragging && performance.now() - this.down.t < 600;
    this.down = null;
    if (!wasTap || !this.enabled) return;
    const h = this.pick(e.clientX, e.clientY);
    if (h) h.onTap();
    else this.onMiss();
  };

  private pointerCancel = (): void => {
    this.down = null;
    this.dragging = false;
  };

  dispose(): void {
    this.el.removeEventListener("pointerdown", this.pointerDown);
    this.el.removeEventListener("pointermove", this.pointerMove);
    this.el.removeEventListener("pointerup", this.pointerUp);
    this.el.removeEventListener("pointercancel", this.pointerCancel);
  }
}
