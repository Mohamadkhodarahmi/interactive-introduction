# Visual direction

## One sentence

A real, slightly worn observation room 230 m above a rainy city at night — the
drama comes from light (a dead room that powers up, a city that switches back on,
one strange point of light) rather than from effects.

## Principles

1. **Light tells the story.** Each beat is a lighting change: emergency red → work
   light + city wave → cold storm → desaturated memory → warm light behind a door →
   a desk lamp.
2. **Controlled glow.** Only surfaces that *emit* feed bloom (an `emissive` MRT
   target). Wet floors, reflections and bright paint never bloom.
3. **Materials over textures.** No bitmap textures ship. Surfaces get their character
   from procedural TSL: tiled access floor with per-tile roughness and seams, painted
   steel with low-frequency grime, brushed metal, hazard paint with wear, wood planks
   and grain.
4. **Believable scale.** Metric units everywhere: 60 cm floor tiles, 3.6 m ceiling,
   1.05 m handrail, 0.74 m desk, a 230 m drop to the street.
5. **Restraint in UI.** Persian subtitles centred low like film subtitles (no boxes),
   a small monospace system log top-left, thin-bordered buttons. No glassmorphism,
   no giant text, no gradients-as-design.

## Palette (linear-ish intent)

| Use | Colour |
| --- | --- |
| Night haze / fog | `#0b0c10` |
| Sky zenith → horizon | `#010203` → city-lit `#0d0b0c` |
| Emergency | `#ff2a10` (pulsing) |
| Work light (4000 K) | `#ffe2c0` |
| Warm reveal (2700 K) | `#ffa860` / `#ffb070` |
| Signal | `#c6ecff` (very pure, slightly cold) |
| System text | `#a9bccb`, ok `#86c7b9`, warn `#d9a441`, error `#d0584a` |

## Environments

### Observation room (OBS-07)
- Leaning glass wall (15.5°) in steel mullions, transom, handrail; exterior wet ledge
  with ripples and splashes, a mast with an obstruction light.
- Console with slanted control deck (instanced indicator buttons), three monitors
  (live canvas UIs), keyboard, mug, papers; an office chair left pushed back.
- `MAIN BUS 07` breaker pedestal with a hinged hazard cover and a red lever — the
  only light in the dark room is its blinking amber standby LED.
- Server racks with instanced LEDs, cable tray with sagging cables, floor cables,
  a ceiling leak dripping into a puddle (drip synchronised with sound).
- Sealed door with its own display panel, hazard threshold, emergency lamp.
- Planar-reflective floor (medium/high) + PMREM environment regenerated per
  lighting state (offline / powered / warm).

### City
- ~900–2300 instanced buildings on a road grid, a tall core in the distance, low
  foreground so the view opens over the roofs.
- Façade shader: office ribbon windows vs residential windows, piers, blinds, warm /
  neutral / rare fluorescent light, whole lit floors in offices, distance LOD.
- Blackout radius around the facility; on power restore a wave re-lights the district
  outward.
- Sodium street lamps and traffic as instanced sprites with screen-size clamping,
  aviation beacons, a fbm cloud deck lit from below, lightning.

### Memory room
- Flooded archive, ring of concrete piers, collapsed beams, darkness above.
- Gravity anomaly: chair, monitors, papers and glass shards float and tumble; rain
  hangs in the air drifting *up*.
- A broken holographic wireframe of the observation room; suspended screens replay
  fragments; three memory shards to recover; a central core display replays the
  branch the user chose.
- Post: heat-haze warp + light row-tearing glitch that clears as memory is restored.

### Hidden room
- Small, warm, lived-in: plank floor, rug, plaster walls, a rainy window over the same
  city, desk, laptop (hinged lid, live screen), headphones, notebook + pen, coffee with
  steam, articulated lamp, plant, a shelf of books, a framed line drawing of OBS-07.

## Camera

`CameraManager` poses: `observationRoom`, `console`, `monitor`, `window`, `signal`,
`memoryEntry`, `memoryRoom`, `memoryCore`, `identity`, `reveal`, `finalStart`,
`finalRoom`, `laptop`. Moves are GSAP tweens of position + target with the target
leading slightly; a subtle two-frequency handheld drift; drag-to-look within per-pose
limits; optional device-motion parallax. Portrait screens get per-pose overrides and a
widened vertical FOV so the horizontal framing survives.
