# UNKNOWN SYSTEM

A cinematic, mobile-first interactive 3D introduction built with Three.js (WebGPU + TSL,
WebGL2 fallback), GSAP and Web Audio. You wake up in a dead observation room above a rainy
city, restore power, follow a strange light, repair a corrupted memory — and the system
eventually asks your name, opens a door, and the person who built it says hello.

Everything (city, rooms, materials, environment maps, sound) is generated at runtime — no
models, textures or audio files are downloaded.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview
```

Deploys to Vercel as-is (`vercel.json`, framework: vite).

## Make it yours

Edit `src/config.ts`:

- `CREATOR.name` — the name used in «من … هستم».
- `CREATOR.nameLatin` — shown on the laptop.
- `CREATOR.contacts` — channels shown at the end (Telegram, GitHub…). The card stays open so visitors can open one, come back and open another.

## URL options

- `?quality=low|medium|high` — force a quality level (also in the settings menu).
- `?webgl` — force the WebGL2 backend.
- Dev only: `?debug=offline|calm|signal|warm|memory|final&cam=<pose>` jumps to a state.

## QA

```bash
npm run dev &
node scripts/playthrough.mjs investigate            # desktop
node scripts/playthrough.mjs ignore 390 844          # phone viewport
GPU=1 node scripts/playthrough.mjs approach          # real WebGPU backend (SwiftShader)
Q=high GPU=1 node scripts/playthrough.mjs investigate  # force a quality level
```

Docs: [`docs/`](docs) — architecture, visual direction, audio design, performance,
reference analysis. Plan and status: [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md).
