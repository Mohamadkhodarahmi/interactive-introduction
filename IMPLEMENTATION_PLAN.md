# Implementation plan & status

| # | Phase | Status |
| --- | --- | --- |
| 1 | Inspect repo (empty) and reference project; write `docs/reference-analysis.md` | ✅ |
| 2 | Vite + TypeScript + three r186 (`three/webgpu`, TSL) + GSAP scaffold, Vercel config | ✅ |
| 3 | Core: renderer with WebGPU→WebGL2 fallback, RenderPipeline post stack, state store, decision provider, camera manager, interactor, UI, synthesized audio engine, quality + adaptive DPR, asset manager | ✅ |
| 4 | Scene 0 — arrival in the offline room (system log, Persian lines, «شروع», audio unlock) | ✅ |
| 5 | Scene 1 — physical breaker on the console; staged power-up; city relights in a wave | ✅ |
| 6 | Scene 2 — the signal (Morse "HELLO"); three real branches: approach / investigate / ignore | ✅ |
| 7 | Scene 3 — memory corruption → separate memory room; three fragments; branch-specific replay | ✅ |
| 8 | Scene 4 — analysis via `LocalDecisionProvider` (predefined lines only) | ✅ |
| 9 | Scene 5 — identity; name stored locally; warm light; door unlocks | ✅ |
| 10 | Scene 6 — hidden room, laptop reveal, creator lines, contact (optional), finale, replay | ✅ |
| 11 | Planar reflections, glass refraction with drops, ripples, rain, lightning | ✅ |
| 12 | Mobile: portrait poses, touch targets, safe areas, quality tiers | ✅ |
| 13 | Runtime fallback (device lost / repeated render errors → WebGL2), graceful chunk failures | ✅ |
| 14 | Headless playthroughs of all branches, desktop + phone, replay verified | ✅ |
| 15 | Docs reflect implementation | ✅ |

## Next improvements

- Real-device profiling on mid-range Android (WebGPU path could not be exercised in the
  headless CI-like environment used here — only the WebGL2 backend was verified).
- Optional recorded foley to layer over the synthesized ambience.
- `JevDecisionProvider` implementing `DecisionProvider` (choose among predefined actions).
- A backend endpoint for visitor contacts (currently local / mail draft only).
- Light probes / baked AO for the interiors.
