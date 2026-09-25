# Audio design

Everything you hear is synthesised at runtime with the Web Audio API
(`src/audio/AudioEngine.ts`). There are no audio files to download, so sound is
available the instant the user taps «شروع».

## Unlock & lifecycle

- The `AudioContext` is created **inside the first click handler** (`UI.onClick` →
  `AudioEngine.unlock()`), which satisfies iOS/Safari autoplay rules.
- The page's visibility changes suspend/resume the context.
- Mute is a master-gain ramp (no clicks) and is remembered per device.
- If Web Audio is unavailable the engine marks itself failed and every call becomes a
  no-op — the experience continues silently.

## Signal flow

```
 rain far (pre-rendered droplets → HP → LP) ┐
 rain near (sparse glass taps → shelf)       ├─ ambience ─ muffle LP ─┐
 city bed (brown → LP 380)             │                        │
 traffic swells (scheduled bursts)     │                        ├─ master ─ compressor ─ out
 electrical hum (50/100/150/200/250Hz) ┘                        │
 pads (detuned saws + sine root → LP w/ LFO) ─ music ───────────┤
 signal tone (880 + 1320.8 Hz, Morse-gated) ─ music ────────────┤
 one-shots ─ sfx ───────────────────────────────────────────────┘
 (pads, signal, most one-shots also feed a convolution reverb with a generated IR)
```

## Scene-reactive layers

| Beat | Rain | City | Hum | Muffle | Pad |
| --- | --- | --- | --- | --- | --- |
| Arrival (offline) | medium, distant | low | off | slight | `offline` (D minor, open) |
| Power restored | medium | up | on (fades in with lights) | slight | `power` (Dm add9) |
| Signal | — | — | — | — | `signal` (unstable, tritone colour) + Morse tone |
| A · Approach | full, close to the glass | up | lower | none | + thunder, lightning cracks |
| B · Investigate | unchanged | unchanged | unchanged | — | servo, scan sweep, decode ticks |
| C · Ignore | drops away | drops away | low | heavy | pad fades almost out; the signal returns with a glitch |
| Memory room | faint | off | off | heavy | `memory` (low, detuned) + crystalline fragment chimes |
| Analysis | quiet | quiet | low | medium | `analysis` (bare fifth) + scan |
| Identity | softer | softer | low | medium | `identity` (F maj7) |
| Final room | muffled through the window | faint | off | heavy | silence → `final` (G maj9) after the reveal |

## Rain

Rain is not filtered noise. At unlock (deferred a few ms so the tap stays snappy) two
seamless loops are rendered from thousands of individual droplets — each a very short,
randomly pitched resonance with a tiny impact tick, randomly panned — over a quiet noise
bed. The far loop is dense (roofs/streets), the near loop is sparse and brighter (drops on
the glass). There is no periodic modulation anywhere, which is what made the earlier
version sound like a helicopter.

## Thunder

`thunder(distance)` is called at the moment of the flash and schedules its own delay from
the speed of sound (≈343 m/s over 0.25–3.75 km, compressed ×0.6 for pacing, max ≈4.4 s).
Close strikes add a bright crack; every strike rolls with 3–5 overlapping low bursts at
irregular offsets so the rumble tumbles instead of fading linearly.

## The signal

The unknown light blinks **HELLO in Morse** (`.... . .-.. .-.. ---`). The same
`MorseClock` drives the light, the audio gate and the oscilloscope on the console
monitor, so what you hear, what you see and what the screens decode are the same
data. The investigate branch decodes `H E L L _` before the memory corrupts; the
memory room completes the word; the laptop in the final room repeats it — tying the
signal to the line «می‌تونستم خیلی ساده بگم "سلام، خوبی؟"».

## One-shots

breaker clunk · power-up whine + relay clicks · light flicker buzz · boot arpeggio ·
UI click / tick / confirm / deny · whoosh transitions · thunder (distance-dependent
crack + rumble) · leak drips (synchronised with the visible drop hitting the puddle) ·
servo · scan sweep · memory fragment chimes · door unlock + slide · laptop chime.
