import * as THREE from "three/webgpu";

export interface RendererInfo {
  renderer: THREE.WebGPURenderer;
  isWebGPU: boolean;
}

/**
 * WebGPU first, WebGL2 backend as fallback (same TSL materials run on both).
 * `?webgl` forces the fallback for testing.
 */
export async function createRenderer(canvasParent: HTMLElement): Promise<RendererInfo> {
  const forceWebGL = new URLSearchParams(location.search).has("webgl");
  const hasGPU = typeof navigator !== "undefined" && "gpu" in navigator;

  const attempt = async (webgl: boolean): Promise<RendererInfo> => {
    const renderer = new THREE.WebGPURenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      forceWebGL: webgl,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    await renderer.init();
    const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
    canvasParent.appendChild(renderer.domElement);
    return { renderer, isWebGPU: Boolean(backend.isWebGPUBackend) };
  };

  if (!forceWebGL && hasGPU) {
    try {
      return await attempt(false);
    } catch (err) {
      console.warn("[renderer] WebGPU init failed, falling back to WebGL2", err);
    }
  }
  return attempt(true);
}
