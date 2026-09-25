# Architecture

```
src/
  main.ts                 fonts + CSS, gsap wall-clock timing, boots App
  config.ts               creator name, contact channels, optional inbox email
  core/
    App.ts                renderer + systems, frame loop, replay, quality switch,
                          WebGPU→WebGL runtime fallback, dev-only ?debug= states
    AppContext.ts         the object every scene receives
    Director.ts           the whole story as one async script (scenes 0–6 + contact + end)
    BaseScene.ts          lifecycle: preload → enter → update/beforeRender → exit → dispose
    Renderer.ts           WebGPURenderer (WebGPU first, WebGL2 backend fallback, ?webgl)
    Timeline.ts           abortable wait / abortable promise (replay cancels a running story)
    dispose.ts            deep disposal of geometries, materials, textures, shadow maps
  state/
    ExperienceState.ts    ExperienceState (exact interface from the brief) + behaviour metrics
                          + store with subscribe/reset; name persisted to localStorage only
    decisions.ts          DecisionProvider interface, LocalDecisionProvider, predefined lines
  camera/CameraManager.ts named poses, GSAP moves, handheld drift, drag-look, device motion,
                          portrait overrides + horizontal-FOV preservation
  audio/AudioEngine.ts    synthesised ambience, music pads, signal tone, one-shots, reverb
  interactions/Interactor.ts  touch-first tap vs drag, raycast hotspots, forgiving touch radius
  rendering/
    PostFX.ts             RenderPipeline: MRT(output, emissive) → bloom(emissive) → glitch/CA →
                          ACES → grade → vignette → grain → fade (→ FXAA on high)
    PlanarReflection.ts   mirrored camera + oblique clip, rendered before the pipeline
    environment.ts        PMREM environment built from a stand-in room per lighting state
    Screen.ts             canvas-backed in-world displays (scanlines, noise, power, bloom ratio)
    geo.ts                Batch (merge static geometry per material), cable/tube helpers
    materials/            TSL: city façades, ground, traffic, lamps, beacons, sky, rain,
                          splashes, glass drops, ripples, floor, ledge, painted/metal surfaces
  performance/
    Quality.ts            LOW / MEDIUM / HIGH budgets, auto detection, manual override
    AdaptiveDpr.ts        DPR stepping with hysteresis
  assets/AssetManager.ts  lazy scene modules with retry, background prefetch, bounded font wait
  ui/UI.ts, styles.css    system log, subtitles, choices, name field, contact, hint ring,
                          settings/mute, veil/fatal overlays
  scenes/
    observation/          Scene 0–2, 4–5: room, city, signal (Morse), console painters
    memory/               Scene 3 (lazy chunk)
    final/                Scene 6 + reveal (lazy chunk)
```

## Flow of a frame

1. `AdaptiveDpr.tick`
2. `scene.update(dt, t)` for every scene (inactive ones return immediately)
3. `CameraManager.update` → camera matrices
4. `scene.beforeRender()` (planar reflections)
5. `UI.updateHint` (projected hint ring), `AudioEngine.update` (scheduled ambience)
6. `PostFX.render()` inside a try/catch that triggers the WebGL fallback on repeated errors

## Story ↔ rendering separation

- `ExperienceState` is plain data. The Director writes it; scenes read it (e.g. the memory
  room reads `signalChoice`, the laptop footer reads the whole state).
- Scenes expose visual primitives (`restorePower()`, `approach()`, `corrupt()`,
  `openDoor()`…); only the Director decides order and dialogue.
- The analysis line comes from `DecisionProvider.chooseNextAction()`, which returns one of the
  predefined actions/lines. `LocalDecisionProvider` scores exploration (optional taps,
  drag-look distance, door attempts, revisits), the branch chosen and reaction tempo.
  A future `JevDecisionProvider` implements the same interface and never touches Three.js.

## Scene lifecycle and loading

- The observation scene is in the main bundle and fully procedural, so first paint needs no
  downloads beyond JS and two font files.
- Memory and final scenes are separate chunks (`import()`), prefetched in the background
  during the preceding beat, retried on transient failure. If the memory chunk still fails the
  Director restores memory through dialogue; if the final chunk fails the reveal still plays.
- Replay aborts the running story (`AbortController`), fades out, kills tweens, clears the UI,
  resets audio and state, exits (but keeps) the memory and final scenes (they re-enter and reset next
  time), resets the observation scene's look and starts again.

## Dev tooling

- `?debug=offline|calm|signal|warm|memory|final&cam=<pose>` (dev server only) jumps to a
  visual state.
- `?quality=low|medium|high`, `?webgl` work in production too.
- `scripts/playthrough.mjs <approach|investigate|ignore> [w h]` drives the whole story in
  headless Chromium (taps the breaker, picks a branch, restores memory, types a name, opens the
  contact card, replays) and saves screenshots. `scripts/shot.mjs` / `probe.mjs` are single-shot
  helpers.
