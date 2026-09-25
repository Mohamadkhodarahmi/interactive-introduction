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
