# Performance

## Budgets (`src/performance/Quality.ts`)

| | LOW | MEDIUM | HIGH |
| --- | --- | --- | --- |
| DPR range | 0.6 – 1.0 | 0.75 – 1.35 | 1.0 – 1.75 |
| Rain streaks | 1 600 | 3 600 | 7 000 |
| Buildings | 900 | 1 500 | 2 300 |
| Traffic sprites | 360 | 700 | 1 300 |
| Shadows | off | 1024 (one spot, static) | 2048 |
| Glass refraction (`viewportSharedTexture`) | off (bead shading) | on | on |
| Planar floor / water reflection | off (PMREM only) | 0.35× res | 0.5× res |
| Bloom resolution | 0.25 | 0.35 | 0.5 |
| FXAA | off | off | on |
| Cloud fbm octaves | 2 | 3 | 4 |
| Memory particles | 500 | 1 100 | 2 000 |

**Auto selection:** phones get MEDIUM when WebGPU is available with ≥6 cores and ≥4 GB,
otherwise LOW; desktops get HIGH with ≥8 cores, otherwise MEDIUM (MEDIUM on WebGL with weak
hardware). `?quality=` or the settings menu overrides and is remembered per device.
Switching quality live updates DPR range, bloom, FXAA, rain/splash counts and shadows;
allocation-sized buffers (building count) apply on the next load.

## What keeps it cheap

- **Instancing everywhere:** buildings, roof clutter, beacons, rack LEDs, console buttons are
  `InstancedMesh`; traffic, lamps, rain, splashes and memory particles are instanced sprites
  whose positions come from `hash(instanceIndex)` + `time` — zero per-frame CPU or buffer
  uploads, identical on WebGL2.
- **Merged static geometry:** `Batch` merges the room per material (a detailed room in ~10
  draws). Measured (WebGL2, MEDIUM, powered room): ~140 draw calls per frame including the
  reflection pass, shadow and post passes; ~140 k triangles.
- **Shadows are static:** `shadow.autoUpdate = false`; refreshed only when lighting changes
  (power restore, corruption flicker, door). No point-light shadows anywhere.
- **Bloom only from emissive MRT**, at reduced resolution.
- **Distance LOD in the façade shader:** far windows collapse to an average glow — no
  shimmering and fewer ALU branches mattering.
- **Canvas screens repaint at capped rates** (8–30 fps each) and only while powered.
- **Reflections** skip once the camera has passed through the door, and hide the
  floor, glass, rain and splashes during their pass.
- **Adaptive DPR:** two slow 1-second windows (<50 fps) step DPR down by 0.15; five
  comfortable windows (>58 fps) step it back up by 0.1. Grace periods after boot/scene
  switches avoid reacting to shader compilation.
- **Warm-up:** `renderer.compileAsync(scene, camera)` for each scene during loading.

## Memory / disposal

- `BaseScene.dispose()` runs registered disposers (render targets, canvas textures, PMREMs)
  then `disposeObject()` over the tree (geometries, materials, textures, shadow maps).
- Memory and final scenes are built once and re-entered on replay (their `enter()` resets them); they share TSL uniform nodes with the observation scene, so they are not disposed mid-session.
- GSAP tweens are killed on replay; story timers are cleared through `AbortSignal`s.

## Mobile notes

- Everything is touch-first; 48–50 px targets; drag-to-look is limited per camera pose.
- Portrait screens keep horizontal framing (vertical FOV widened by at most +18°) and have
  dedicated poses where content would fall outside the frame (breaker, signal, memory,
  laptop).
- The audio context is suspended when the tab is hidden.
- Safe-area insets are respected by the UI.

## Known cost centres

1. Glass refraction (`viewportSharedTexture` copy) — disabled on LOW.
2. Planar reflection (second scene render) — disabled on LOW, reduced resolution elsewhere.
3. Sky fbm — octave count per level.
