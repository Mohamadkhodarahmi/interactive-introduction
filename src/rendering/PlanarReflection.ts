import * as THREE from "three/webgpu";
import { screenUV, texture } from "three/tsl";

const _n = new THREE.Vector3(0, 1, 0);
const _pos = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _view = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _size = new THREE.Vector2();

/**
 * Horizontal planar reflection rendered *before* the post pipeline into its own
 * reduced-resolution target (so there is no read/write hazard inside the
 * PassNode). Uses a mirrored virtual camera with an oblique near plane so nothing
 * below the plane (e.g. the city under the floor) leaks into the reflection.
 */
export class PlanarReflection {
  readonly target: THREE.RenderTarget;
  readonly camera = new THREE.PerspectiveCamera();
  /** Sample this in materials: already mirrored in X. */
  readonly node;
  enabled = true;
  /** Render every N frames (1 = every frame). */
  frameSkip = 1;
  private frame = 0;

  constructor(
    private renderer: THREE.WebGPURenderer,
    private y: number,
    private scale = 0.5,
  ) {
    this.target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target.texture.generateMipmaps = false;
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
    this.node = texture(this.target.texture, screenUV.flipX());
  }

  setScale(s: number): void {
    this.scale = s;
  }

  /** `hide` objects are made invisible during the reflection render (the floor itself, glass…). */
  update(scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]): void {
    if (!this.enabled) return;
    if (this.frame++ % this.frameSkip !== 0) return;
    const r = this.renderer;
    r.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.round(_size.x * this.scale));
    const h = Math.max(1, Math.round(_size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    _pos.set(0, this.y, 0);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    _pos.x = _cam.x;
    _pos.z = _cam.z;
    _view.subVectors(_pos, _cam);
    if (_view.dot(_n) > 0) return; // camera below the plane

    _view.reflect(_n).negate().add(_pos);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cam);
    _target.subVectors(_pos, _look).reflect(_n).negate().add(_pos);

    const vc = this.camera;
    vc.coordinateSystem = camera.coordinateSystem;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    vc.lookAt(_target);
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    _plane.setFromNormalAndCoplanarPoint(_n, _pos).applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = vc.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + e[8]) / e[0];
    _q.y = (Math.sign(_clip.y) + e[9]) / e[5];
    _q.z = -1;
    _q.w = (1 + e[10]) / e[14];
    _clip.multiplyScalar(1 / _clip.dot(_q));
    e[2] = _clip.x;
    e[6] = _clip.y;
    e[10] = r.coordinateSystem === THREE.WebGPUCoordinateSystem ? _clip.z : _clip.z + 1;
    e[14] = _clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const prevTarget = r.getRenderTarget();
    const prevMRT = r.getMRT();
    const prevAuto = r.autoClear;
    r.setMRT(null);
    r.setRenderTarget(this.target);
    r.autoClear = true;
    r.render(scene, vc);
    r.setMRT(prevMRT);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    hide.forEach((o, i) => (o.visible = vis[i]));
  }

  dispose(): void {
    this.target.dispose();
  }
}
