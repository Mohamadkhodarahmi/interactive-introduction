import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * Collects static geometry per material and merges it into one mesh per
 * material: a detailed room in a handful of draw calls.
 */
export class Batch {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (geo.index) geo.dispose();
    // Merging requires identical attribute sets.
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) {
      g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(...pos), this.q, this.s.set(...scale));
    g.applyMatrix4(this.m);
    const list = this.groups.get(mat) ?? [];
    list.push(g);
    this.groups.set(mat, list);
  }

  box(w: number, h: number, d: number, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]): void {
    this.add(new THREE.BoxGeometry(w, h, d), mat, pos, rot);
  }

  rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]): void {
    this.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), mat, pos, rot);
  }

  cyl(rt: number, rb: number, h: number, mat: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], seg = 16): void {
    this.add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, pos, rot);
  }

  /** Merge everything into meshes and add them to `parent`. */
  build(parent: THREE.Object3D, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, geos] of this.groups) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.groups.clear();
    return out;
  }
}

/** Sagging cable between two points (catenary-ish parabola). */
export function cableGeometry(a: THREE.Vector3, b: THREE.Vector3, sag: number, radius: number, segments = 24): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segments, radius, 6, false);
}

/** Cable lying on the floor following a list of points. */
export function floorCableGeometry(points: THREE.Vector3[], radius: number): THREE.TubeGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.3), points.length * 10, radius, 6, false);
}
