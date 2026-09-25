import * as THREE from "three/webgpu";
import type { AppContext } from "./AppContext";
import type { CameraPose } from "../camera/CameraManager";
import { disposeObject } from "./dispose";

export interface GradeSettings {
  /** Multiplier applied to the final colour, pre-grade. */
  exposure: number;
  /** Shadow tint (lift) and highlight tint (gain), linear RGB. */
  lift: [number, number, number];
  gain: [number, number, number];
  saturation: number;
  bloomStrength: number;
  vignette: number;
}

/**
 * Scene lifecycle: preload → enter → update* → exit → dispose.
 * A scene owns its THREE.Scene and everything in it.
 */
export abstract class BaseScene {
  readonly scene = new THREE.Scene();
  abstract readonly id: string;
  /** Named camera poses this scene contributes to the CameraManager. */
  abstract readonly poses: Record<string, CameraPose>;
  protected loaded = false;
  protected active = false;
  private disposers: (() => void)[] = [];

  constructor(protected ctx: AppContext) {}

  /** Build geometry/materials. Must be idempotent. */
  async preload(): Promise<void> {
    if (this.loaded) return;
    await this.build();
    this.loaded = true;
  }

  protected abstract build(): Promise<void>;

  enter(): void {
    this.active = true;
  }

  abstract update(dt: number, elapsed: number): void;

  /** Called after the camera has moved, right before the frame is rendered. */
  beforeRender(): void {}

  /**
   * Shader warm-up through the *real* render path (post pipeline with its MRT
   * targets — `renderer.compileAsync` uses a different render context and does
   * not cover it). Frustum culling is switched off so objects outside the
   * current view (behind you when you drag-look) get their pipelines too.
   * Renders at fade = 1, so nothing is visible.
   */
  async warm(prepare?: () => void): Promise<void> {
    const { post } = this.ctx;
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
    const prevScene = post.getScene();
    const prevFade = post.u.fade.value;
    const wasActive = this.active;
    post.setScene(this.scene);
    post.u.fade.value = 1;
    this.active = true;
    try {
      prepare?.();
      this.beforeRender();
      post.render();
    } catch (err) {
      console.warn("[warm]", err);
    }
    this.active = wasActive;
    culled.forEach((o) => (o.frustumCulled = true));
    post.u.fade.value = prevFade;
    post.setScene(prevScene);
    // Give async pipeline creation (WebGPU) a frame to settle.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  exit(): void {
    this.active = false;
  }

  /** Register cleanup that isn't an Object3D (listeners, tweens, render targets…). */
  protected onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
    disposeObject(this.scene);
    this.scene.clear();
    if (this.scene.environment) this.scene.environment.dispose();
    this.loaded = false;
  }
}
