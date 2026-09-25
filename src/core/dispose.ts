import * as THREE from "three/webgpu";

/** Recursively dispose geometries, materials and textures owned by an object tree. */
export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => materials.add(m));
    const light = obj as THREE.Light & { shadow?: THREE.LightShadow };
    if (light.isLight && light.shadow?.map) light.shadow.map.dispose();
  });

  for (const m of materials) {
    for (const value of Object.values(m)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    m.dispose();
  }
  geometries.forEach((g) => g.dispose());
  textures.forEach((t) => t.dispose());
}
