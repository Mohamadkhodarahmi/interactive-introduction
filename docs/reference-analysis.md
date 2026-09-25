# Reference analysis — `ektogamat/threejs-conference`

Studied at commit HEAD (shallow clone, September 2026). Nothing from the reference —
code, textures, models, videos or branding — is copied into UNKNOWN SYSTEM. This
document records what was learned and how it was adapted.

## What the reference is

A walkable rainy "cyberpunk" street built on `three/webgpu` (r185) + TSL, with GSAP
camera direction, GLB city/car/billboard assets, KTX2/WebP textures, a heavy
post-processing stack and a performance profile keyed on device class.

Source layout worth noting:

| Area | Files | Idea |
| --- | --- | --- |
| Bootstrap | `bootstrap/createRenderer.js` | `WebGPURenderer` with negotiated `requiredLimits`, ACES tone mapping, `shadowMap.autoUpdate = false` |
| Platform | `platform/performanceProfile.js`, `adaptiveDpr.js` | one mutable profile object; DPR drops once after two slow FPS windows and never climbs back |
| Post | `post/postprocessing.js`, `post/look/*` | `RenderPipeline` + MRT (`output` + `emissive`), bloom only on the emissive target, lens flare from bloom, GTAO, SMAA, film grain, look presets (grade, fog, CA, vignette) |
| TSL | `tsl/rainGlass.js`, `tsl/rainRipples.js`, `tsl/boxBlur.js` | rain-on-glass screen pass (a port of rocksdanister's drop layers), procedural ripple normals, separable blur |
| Weather | `world/weather/createCollisionRain.js` | GPU instanced rain streaks + splash sprites, collision height map rendered from above |
| Ground | `world/ground/createGround.js` | manual planar reflection render target (instead of `reflector()` inside a `PassNode`) warped by normal map + ripples |
| Runtime | `runtime/createCameraDirector.js`, `warmup.js` | scripted camera shots, shader warm-up before reveal |

## Techniques adapted (conceptually, re-implemented)

1. **Emissive MRT → bloom.** Bloom is fed only from an `emissive` MRT attachment, so
   wet reflections and bright diffuse surfaces never bloom. This is the single most
   important trick for "controlled" glow and is used in `src/rendering/PostFX.ts`.
2. **Instanced GPU rain driven by `instanceIndex` + `time`.** No per-frame CPU work.
   Our version (`src/rendering/materials/rain.ts`) needs no storage buffers at all:
   every streak derives its seed from `hash(instanceIndex)`, which keeps it working on
   the WebGL2 fallback backend.
3. **Ripple normals.** The reference sums expanding rings in a 3×3 cell neighbourhood.
   We use a cheaper single-cell + neighbour variant (`src/rendering/materials/ripples.ts`)
   for the interior puddle and the exterior ledge.
4. **Rain on glass.** The reference applies drops as a full-screen pass during its
   intro. We instead shade the drops *on the window mesh itself* and refract the
   already-rendered city through `viewportSharedTexture`, so drops exist only where
   glass exists and respond to camera parallax. Low quality skips refraction.
5. **Adaptive DPR + a profile object.** Kept the idea of one profile of budgets
   (`src/performance/Quality.ts`), but our DPR controller steps both down *and* back up
   with hysteresis, since this experience has quiet scenes that can afford more pixels.
6. **Shadow maps updated on demand.** Static lighting ⇒ `autoUpdate = false`, refresh
   only when lights change (power restore, door opening).
7. **Film grain + vignette + subtle chromatic aberration in a final "look" pass.**
   Ours is a single TSL function with a scene-driven grade (cold blue → warm).

## Techniques deliberately not used

| Technique | Why not |
| --- | --- |
| GTAO | Expensive on mobile tile GPUs; our interiors get contact darkening from baked-in geometry detail and light placement instead. |
| Lens flare pass | Reads as "effect"; conflicts with the brief's "no excessive bloom". |
| Depth of field | Costly and fights legibility of Persian subtitles on small screens. |
| Collision height-map rain | Needed for a walkable street; our rain lives outside a window. |
| Video billboards / GLB city | Heavy downloads. Our city is fully procedural (instanced boxes + façade shader), loads instantly and costs ~4 draw calls. |
| Planar reflection render target for floors | Doubles scene cost. We rely on a generated PMREM environment + ripple-perturbed normals; the room is mostly dark so env reflections read convincingly. |

## Mobile considerations taken from the reference

- Cap DPR (reference: 1.5 max; ours: 1.0 / 1.35 / 1.75 by quality level).
- Half- or quarter-resolution bloom.
- Disable lens flare, AO and DoF on phones — we never enable them.
- Avoid pipeline rebuilds while Safari/WebGPU is compiling; we compile (`compileAsync`)
  before the first reveal and only rebuild the post graph when quality changes.
- Keep shadow maps static.

## How UNKNOWN SYSTEM differs

- A narrative, choice-driven experience (state machine + director), not a free walk.
- Three distinct environments (observation room, memory room, hidden room) that are
  code-split and lazily loaded.
- No external binary assets at all: geometry, textures, environment maps and audio are
  all generated at runtime. First paint needs only JS + two font files.
- Synthesised Web Audio sound design instead of recorded loops.
- Persian RTL subtitle UI designed for touch first.
