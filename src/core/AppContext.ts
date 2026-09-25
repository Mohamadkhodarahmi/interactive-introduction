import type * as THREE from "three/webgpu";
import type { CameraManager } from "../camera/CameraManager";
import type { AudioEngine } from "../audio/AudioEngine";
import type { UI } from "../ui/UI";
import type { ExperienceStore } from "../state/ExperienceState";
import type { DecisionProvider } from "../state/decisions";
import type { Interactor } from "../interactions/Interactor";
import type { PostFX } from "../rendering/PostFX";
import type { QualityProfile } from "../performance/Quality";
import type { AssetManager } from "../assets/AssetManager";

export interface AppContext {
  renderer: THREE.WebGPURenderer;
  isWebGPU: boolean;
  cameras: CameraManager;
  audio: AudioEngine;
  ui: UI;
  store: ExperienceStore;
  decisions: DecisionProvider;
  interactor: Interactor;
  post: PostFX;
  assets: AssetManager;
  /** Current quality profile (mutable reference; scenes read it on build/update). */
  quality: QualityProfile;
}
