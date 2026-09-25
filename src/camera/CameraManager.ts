import * as THREE from "three/webgpu";
import gsap from "gsap";

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Vertical FOV at 16:9. Adapted automatically for portrait screens. */
  fov?: number;
  /** Idle handheld drift amplitude (metres). */
  sway?: number;
  /** How far the user may drag-look, radians. */
  look?: { yaw: number; pitch: number };
  /** Optional overrides for portrait (aspect < 1) screens. */
  portrait?: { position?: THREE.Vector3; target?: THREE.Vector3; fov?: number };
}

export const CAMERA_STATES = [
  "observationRoom",
  "console",
  "window",
  "signal",
  "memoryRoom",
  "identity",
  "reveal",
  "finalRoom",
] as const;

export type CameraStateName = (typeof CAMERA_STATES)[number] | (string & {});

interface GoToOptions {
  duration?: number;
  ease?: string;
  /** Pull the path slightly upward/sideways for a less linear move. */
  arc?: number;
}

/**
 * Owns the single perspective camera. Cinematic moves are GSAP tweens of a
 * position + look-target pair; on top of that sit a subtle handheld drift, the
 * user's drag-to-look offset and optional device-motion parallax.
 */
export class CameraManager {
  readonly camera: THREE.PerspectiveCamera;
  private poses = new Map<string, CameraPose>();
  current: CameraStateName = "observationRoom";

  private pos = new THREE.Vector3(0, 1.6, 3);
  private target = new THREE.Vector3(0, 1.5, -5);
  private baseFov = 50;
  private sway = 0.012;
  private lookLimit = { yaw: 0.3, pitch: 0.15 };

  /** User look offsets (radians), smoothed. */
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private motion = new THREE.Vector2();
  private motionTarget = new THREE.Vector2();
  private tween: gsap.core.Timeline | null = null;
  private shakeAmount = 0;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 6000);
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  register(poses: Record<string, CameraPose>): void {
    for (const [k, v] of Object.entries(poses)) this.poses.set(k, v);
  }

  has(name: string): boolean {
    return this.poses.has(name);
  }

  private resolve(p: CameraPose): { position: THREE.Vector3; target: THREE.Vector3; fov: number } {
    const portrait = this.camera.aspect < 1;
    const position = (portrait && p.portrait?.position) || p.position;
    const target = (portrait && p.portrait?.target) || p.target;
    const fov = (portrait && p.portrait?.fov) || p.fov || 50;
    return { position, target, fov };
  }

  /** Instantly place the camera at a pose. */
  set(name: CameraStateName): void {
    const pose = this.poses.get(name);
    if (!pose) throw new Error(`Unknown camera pose ${name}`);
    this.tween?.kill();
    const r = this.resolve(pose);
    this.pos.copy(r.position);
    this.target.copy(r.target);
    this.baseFov = r.fov;
    this.sway = pose.sway ?? 0.012;
    this.lookLimit = pose.look ?? { yaw: 0.3, pitch: 0.15 };
    this.current = name;
    this.yawTarget = this.pitchTarget = 0;
  }

  /** Cinematic move to a named pose. Resolves when the move ends. */
  goTo(name: CameraStateName, opts: GoToOptions = {}): Promise<void> {
    const pose = this.poses.get(name);
    if (!pose) return Promise.reject(new Error(`Unknown camera pose ${name}`));
    const { duration = 2.4, ease = "power2.inOut", arc = 0 } = opts;
    const r = this.resolve(pose);
    this.tween?.kill();
    this.current = name;
    this.lookLimit = pose.look ?? { yaw: 0.3, pitch: 0.15 };
    // Ease the user's look offset home while we move.
    this.yawTarget = 0;
    this.pitchTarget = 0;

    const from = this.pos.clone();
    const to = r.position.clone();
    const tStart = this.target.clone();
    const state = { k: 0, fov: this.baseFov, sway: this.sway };
    return new Promise((resolve) => {
      this.tween = gsap.timeline({ onComplete: () => resolve() });
      this.tween.to(state, {
        k: 1,
        fov: r.fov,
        sway: pose.sway ?? 0.012,
        duration,
        ease,
        onUpdate: () => {
          this.pos.lerpVectors(from, to, state.k);
          if (arc) this.pos.y += Math.sin(state.k * Math.PI) * arc;
          // Target leads position slightly for a more natural "look then move".
          const kt = Math.min(1, state.k * 1.15);
          this.target.lerpVectors(tStart, r.target, kt);
          this.baseFov = state.fov;
          this.sway = state.sway;
        },
      });
    });
  }

  /** Drag-to-look input, in normalised screen units. */
  addLook(dx: number, dy: number): void {
    // Grab-the-world convention (like 360° photo viewers) on both axes.
    this.yawTarget = THREE.MathUtils.clamp(this.yawTarget + dx * 1.4, -this.lookLimit.yaw, this.lookLimit.yaw);
    this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + dy * 1.0, -this.lookLimit.pitch, this.lookLimit.pitch);
  }

  releaseLook(): void {
    // Keep a little of where the user looked; drift home slowly in update().
  }

  setDeviceMotion(x: number, y: number): void {
    this.motionTarget.set(x, y);
  }

  shake(amount: number, duration = 0.6): void {
    const s = { a: amount };
    this.shakeAmount = amount;
    gsap.to(s, {
      a: 0,
      duration,
      ease: "power2.out",
      onUpdate: () => {
        this.shakeAmount = s.a;
      },
    });
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Re-resolve portrait overrides for the current pose without animation.
    const pose = this.poses.get(this.current);
    if (pose && !this.tween?.isActive()) {
      const r = this.resolve(pose);
      this.pos.copy(r.position);
      this.target.copy(r.target);
      this.baseFov = r.fov;
    }
  }

  update(dt: number, t: number): void {
    const k = 1 - Math.exp(-dt * 4);
    // Look offsets relax toward zero very slowly so the frame recomposes itself.
    this.yawTarget *= 1 - dt * 0.08;
    this.pitchTarget *= 1 - dt * 0.08;
    this.yaw += (this.yawTarget - this.yaw) * k;
    this.pitch += (this.pitchTarget - this.pitch) * k;
    this.motion.lerp(this.motionTarget, 1 - Math.exp(-dt * 3));

    const cam = this.camera;
    // Handheld drift: two incommensurate sines per axis.
    const s = this.sway;
    const ox = (Math.sin(t * 0.31) * 0.6 + Math.sin(t * 0.83 + 1.3) * 0.4) * s;
    const oy = (Math.sin(t * 0.47 + 0.7) * 0.6 + Math.sin(t * 1.13) * 0.4) * s * 0.7;
    const sh = this.shakeAmount;
    const shx = sh ? (Math.random() - 0.5) * sh : 0;
    const shy = sh ? (Math.random() - 0.5) * sh : 0;

    cam.position.set(this.pos.x + ox + shx, this.pos.y + oy + shy, this.pos.z);

    // Direction with user yaw/pitch applied.
    this.dir.subVectors(this.target, this.pos);
    const dist = this.dir.length();
    this.dir.normalize();
    this.right.crossVectors(this.dir, this.up).normalize();
    const yaw = this.yaw + this.motion.x * 0.06;
    const pitch = this.pitch + this.motion.y * 0.04;
    this.dir.applyAxisAngle(this.up, yaw);
    this.dir.applyAxisAngle(this.right, pitch);
    this.tmp.copy(cam.position).addScaledVector(this.dir, dist);
    cam.lookAt(this.tmp);

    // Portrait: widen vertical FOV so the horizontal framing survives.
    const aspect = cam.aspect;
    let fov = this.baseFov;
    if (aspect < 1.25) {
      const hRad = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * 1.25);
      const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hRad / 2) / aspect));
      fov = Math.min(v, fov + 18);
    }
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
