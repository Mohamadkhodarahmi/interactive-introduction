import * as THREE from "three/webgpu";

export interface EnvPanel {
  /** Centre, size (w,h), facing normal (into the room), colour × intensity. */
  position: [number, number, number];
  size: [number, number];
  normal: [number, number, number];
  color: THREE.ColorRepresentation;
  intensity: number;
}

export interface EnvSpec {
  room: { w: number; h: number; d: number; center: [number, number, number] };
  wall: THREE.ColorRepresentation;
  floor: THREE.ColorRepresentation;
  panels: EnvPanel[];
  /** Optional gradient "window" backdrop: a vertical gradient strip on one wall. */
  window?: { position: [number, number, number]; size: [number, number]; normal: [number, number, number]; top: THREE.ColorRepresentation; bottom: THREE.ColorRepresentation; intensity: number };
}

/**
 * Builds a tiny stand-in scene of the room (walls + light panels + window glow)
 * and pre-filters it into a PMREM. Gives believable reflections on metal, glass
 * and wet floors for the cost of one texture lookup.
 */
export function buildEnvironment(renderer: THREE.WebGPURenderer, spec: EnvSpec): THREE.Texture {
  const scene = new THREE.Scene();
  const { w, h, d, center } = spec.room;
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
    new THREE.MeshBasicMaterial({ color: spec.wall, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: spec.wall, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: spec.wall, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: spec.floor, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: spec.wall, side: THREE.BackSide }),
    new THREE.MeshBasicMaterial({ color: spec.wall, side: THREE.BackSide }),
  ]);
  box.position.set(...center);
  scene.add(box);

  const place = (mesh: THREE.Mesh, pos: [number, number, number], normal: [number, number, number]) => {
    mesh.position.set(...pos);
    const n = new THREE.Vector3(...normal).normalize();
    mesh.lookAt(mesh.position.clone().add(n));
    scene.add(mesh);
  };

  for (const p of spec.panels) {
    const c = new THREE.Color(p.color).multiplyScalar(p.intensity);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.size[0], p.size[1]), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    place(m, p.position, p.normal);
  }
  if (spec.window) {
    const win = spec.window;
    const geo = new THREE.PlaneGeometry(win.size[0], win.size[1], 1, 8);
    const top = new THREE.Color(win.top).multiplyScalar(win.intensity);
    const bottom = new THREE.Color(win.bottom).multiplyScalar(win.intensity);
    const colors: number[] = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = (pos.getY(i) / win.size[1]) + 0.5;
      const c = bottom.clone().lerp(top, k);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    place(m, win.position, win.normal);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.035, 0.1, 100);
  pmrem.dispose();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((mm) => mm.dispose());
  });
  return rt.texture;
}
