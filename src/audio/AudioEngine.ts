/**
 * Fully synthesised sound design (no audio files). Layers:
 *  ambience bus: rain (far + near), city bed + passing traffic, electrical hum
 *  music bus:    chord pads, signal tone
 *  sfx bus:      one-shots (breaker, boot, clicks, confirmations, glitches, thunder…)
 * Everything routes through a shared convolution reverb with a generated impulse.
 * The context is only created after the first user gesture.
 */

type Chord = number[];

const CHORDS: Record<string, Chord> = {
  // Frequencies in Hz. Voicings kept low and open so they sit under dialogue.
  offline: [73.42, 110.0, 146.83],
  power: [73.42, 110.0, 174.61, 220.0, 261.63],
  signal: [69.3, 103.83, 155.56, 207.65, 311.13],
  memory: [65.41, 98.0, 155.56, 233.08],
  analysis: [82.41, 123.47],
  identity: [87.31, 130.81, 174.61, 220.0, 329.63],
  final: [98.0, 146.83, 196.0, 246.94, 293.66, 369.99],
  silent: [],
};

function makeNoise(ctx: AudioContext, seconds: number, kind: "white" | "pink" | "brown"): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else if (kind === "pink") {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the loop seam.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
  }
  return buf;
}

/**
 * Pre-rendered rain texture: thousands of individual droplets (short, decaying,
 * randomly pitched resonances with a tiny noise "tick") over a soft noise bed.
 * Drops are written with wrap-around so the buffer loops seamlessly — no periodic
 * modulation, so no "helicopter" flutter.
 */
async function makeRain(ctx: AudioContext, seconds: number, o: { rate: number; fLo: number; fHi: number; decayMs: [number, number]; bed: number; tick: number; seed: number }): Promise<AudioBuffer> {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let seed = o.seed;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Bed: low-passed white noise, very quiet.
  let bl = 0;
  let br = 0;
  for (let i = 0; i < len; i++) {
    bl += (rnd() * 2 - 1 - bl) * 0.35;
    br += (rnd() * 2 - 1 - br) * 0.35;
    L[i] = bl * o.bed;
    R[i] = br * o.bed;
  }
  const drops = Math.floor(o.rate * seconds);
  for (let d = 0; d < drops; d++) {
    // Yield regularly so rendering the texture never blocks a frame.
    if (d % 400 === 399) await new Promise((r) => setTimeout(r, 0));
    const start = Math.floor(rnd() * len);
    const f = o.fLo * Math.pow(o.fHi / o.fLo, rnd());
    const decay = (o.decayMs[0] + rnd() * (o.decayMs[1] - o.decayMs[0])) / 1000;
    const amp = Math.pow(rnd(), 2.2) * 0.6 + 0.02;
    const pan = rnd();
    const n = Math.floor(decay * sr * 4);
    const w = (2 * Math.PI * f) / sr;
    const chirp = 1 + (rnd() - 0.3) * 0.5; // droplets ring up slightly in pitch
    let phase = rnd() * 6.28;
    for (let k = 0; k < n; k++) {
      const t = k / sr;
      const env = Math.exp(-t / decay);
      phase += w * (1 + (chirp - 1) * (k / n));
      let v = Math.sin(phase) * env * amp;
      if (k < 40) v += (rnd() * 2 - 1) * o.tick * amp * (1 - k / 40); // impact tick
      const idx = (start + k) % len;
      L[idx] += v * (1 - pan * 0.7);
      R[idx] += v * (0.3 + pan * 0.7);
    }
  }
  // Normalise.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < len; i++) {
    L[i] *= k;
    R[i] *= k;
  }
  return buf;
}

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Early reflections + diffuse tail.
      const early = i < ctx.sampleRate * 0.03 && Math.random() < 0.004 ? 0.8 : 0;
      d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * 0.6;
    }
  }
  return buf;
}

interface PadVoice {
  oscs: OscillatorNode[];
  gain: GainNode;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambience!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise: Record<string, AudioBuffer> = {};

  // Continuous layers
  private rainFar!: { gain: GainNode; filter: BiquadFilterNode };
  private rainNear!: { gain: GainNode; filter: BiquadFilterNode };
  private cityBed!: { gain: GainNode; filter: BiquadFilterNode };
  private hum!: { gain: GainNode; filter: BiquadFilterNode };
  private signal!: { gain: GainNode; gate: GainNode; osc: OscillatorNode; osc2: OscillatorNode; pan: StereoPannerNode };
  private pad: PadVoice | null = null;
  private padLevel = 0.5;
  private muffle!: BiquadFilterNode;
  private trafficTimer = 0;
  private dripTimer = 0;
  muted = false;
  private failed = false;
  /** Whether periodic interior drips should play (observation room leak). */
  drips = false;

  get ready(): boolean {
    return Boolean(this.ctx) && !this.failed;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state !== "running") await this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.build(ctx);
      await ctx.resume().catch(() => undefined);
    } catch (err) {
      console.warn("[audio] unavailable", err);
      this.failed = true;
      this.ctx = null;
    }
  }

  private build(ctx: AudioContext): void {
    this.noise.white = makeNoise(ctx, 2.5, "white");
    this.noise.pink = makeNoise(ctx, 3, "pink");
    this.noise.brown = makeNoise(ctx, 4, "brown");

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    this.master.connect(comp).connect(ctx.destination);

    // Global "muffle" filter used when the listener is sealed off (memory / final room).
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 18000;
    this.muffle.Q.value = 0.3;

    this.ambience = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.ambience.connect(this.muffle).connect(this.master);
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.music.gain.value = 0.55;
    this.sfx.gain.value = 0.8;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);

    const loop = (buf: AudioBuffer, rate = 1): AudioBufferSourceNode => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start(ctx.currentTime, Math.random() * buf.duration);
      return src;
    };

    // Rain far: a dense wash of distant droplets on roofs and streets.
    {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 180;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 3200;
      filter.Q.value = 0.3;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      hp.connect(filter).connect(gain).connect(this.ambience);
      this.rainFar = { gain, filter };
      // Rendering the droplet textures takes a moment: do it after the click
      // handler returns so the first tap never feels sluggish.
      void makeRain(ctx, 7, { rate: 2400, fLo: 900, fHi: 5200, decayMs: [1.2, 4], bed: 0.35, tick: 0.6, seed: 11 }).then((b) => {
        const far = ctx.createBufferSource();
        far.buffer = b;
        far.loop = true;
        far.connect(hp);
        far.start(ctx.currentTime, Math.random() * 7);
      });
    }
    // Rain near: individual, sparser drops tapping on the glass right in front of you.
    {
      const filter = ctx.createBiquadFilter();
      filter.type = "highshelf";
      filter.frequency.value = 5000;
      filter.gain.value = -3;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      filter.connect(gain).connect(this.ambience);
      void makeRain(ctx, 5.3, { rate: 260, fLo: 1400, fHi: 7000, decayMs: [2, 9], bed: 0.04, tick: 1.4, seed: 29 }).then((b) => {
        const near = ctx.createBufferSource();
        near.buffer = b;
        near.loop = true;
        near.connect(filter);
        near.start(ctx.currentTime, Math.random() * 5);
      });
      const wet = ctx.createGain();
      wet.gain.value = 0.15;
      gain.connect(wet).connect(this.reverbSend);
      this.rainNear = { gain, filter };
    }
    // City bed: brown noise rumble.
    {
      const src = loop(this.noise.brown);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 380;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.ambience);
      this.cityBed = { gain, filter };
    }
    // Electrical hum: mains fundamental + harmonics.
    {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 600;
      [50, 100, 150, 200, 250].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = f + (Math.random() - 0.5) * 0.3;
        const g = ctx.createGain();
        g.gain.value = [0.5, 0.35, 0.18, 0.08, 0.05][i];
        o.connect(g).connect(filter);
        o.start();
      });
      filter.connect(gain).connect(this.ambience);
      this.hum = { gain, filter };
    }
    // Signal tone: two detuned sines, gated by the Morse pattern the scene drives.
    {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 880;
      const osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = 1320.8;
      const o2g = ctx.createGain();
      o2g.gain.value = 0.25;
      const gate = ctx.createGain();
      gate.gain.value = 0;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(gate);
      osc2.connect(o2g).connect(gate);
      gate.connect(gain).connect(pan);
      pan.connect(this.music);
      pan.connect(this.reverbSend);
      osc.start();
      osc2.start();
      this.signal = { gain, gate, osc, osc2, pan };
    }
  }

  private ramp(param: AudioParam, value: number, time = 1.2): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.setTargetAtTime(value, now, Math.max(0.01, time / 3));
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.ramp(this.master.gain, m ? 0 : 0.9, 0.3);
  }

  /** intensity 0..1, proximity 0..1 (close to glass). */
  setRain(intensity: number, proximity = 0, time = 2): void {
    if (!this.ctx) return;
    this.ramp(this.rainFar.gain.gain, 0.06 + intensity * 0.22, time);
    this.ramp(this.rainFar.filter.frequency, 1800 + intensity * 2400 + proximity * 3000, time);
    this.ramp(this.rainNear.gain.gain, intensity * (0.05 + proximity * 0.25), time);
  }

  setCity(level: number, time = 2): void {
    if (!this.ctx) return;
    this.ramp(this.cityBed.gain.gain, level * 0.5, time);
  }

  setHum(level: number, time = 0.6): void {
    if (!this.ctx) return;
    this.ramp(this.hum.gain.gain, level * 0.05, time);
  }

  /** 0 = open air, 1 = sealed room. */
  setMuffle(amount: number, time = 1.5): void {
    if (!this.ctx) return;
    this.ramp(this.muffle.frequency, 18000 * Math.pow(1 - amount, 2) + 260, time);
  }

  setSignal(level: number, pan = 0, pitch = 880): void {
    if (!this.ctx) return;
    this.ramp(this.signal.gain.gain, level * 0.045, 0.8);
    this.ramp(this.signal.pan.pan, pan, 0.5);
    this.ramp(this.signal.osc.frequency, pitch, 0.5);
    this.ramp(this.signal.osc2.frequency, pitch * 1.501, 0.5);
  }

  /** Called every frame by the scene with the current Morse gate (0/1). */
  signalGate(v: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Soft attack/release so the Morse pulses read as tones, not clicks/beeps.
    this.signal.gate.gain.setTargetAtTime(v, now, 0.03);
  }

  setPad(name: keyof typeof CHORDS | string, level = 0.5, fade = 3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const chord = CHORDS[name] ?? [];
    const now = ctx.currentTime;
    if (this.pad) {
      const old = this.pad;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      window.setTimeout(() => old.oscs.forEach((o) => o.stop()), (fade + 0.2) * 1000);
      this.pad = null;
    }
    if (!chord.length) return;
    this.padLevel = level;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    lp.Q.value = 0.4;
    // Slow filter motion so the pad breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(lp.frequency);
    lfo.start();
    const oscs: OscillatorNode[] = [lfo];
    chord.forEach((f, i) => {
      for (const detune of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? "sine" : "sawtooth";
        o.frequency.value = f;
        o.detune.value = detune + (Math.random() - 0.5) * 3;
        const g = ctx.createGain();
        g.gain.value = (i === 0 ? 0.5 : 0.09) / Math.sqrt(chord.length);
        o.connect(g).connect(lp);
        o.start(now + i * 0.15);
        oscs.push(o);
      }
    });
    lp.connect(gain);
    gain.connect(this.music);
    gain.connect(this.reverbSend);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level * 0.35, now + fade);
    this.pad = { oscs, gain };
  }

  setPadLevel(level: number, time = 2): void {
    if (!this.pad) return;
    this.padLevel = level;
    this.ramp(this.pad.gain.gain, level * 0.35, time);
  }

  get padValue(): number {
    return this.padLevel;
  }

  // ---------------------------------------------------------------- one-shots

  private env(g: GainNode, t0: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; wet?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(freq * opts.slide, t0 + dur);
    const g = ctx.createGain();
    this.env(g, t0, opts.attack ?? 0.005, opts.gain ?? 0.2, dur);
    o.connect(g);
    g.connect(this.sfx);
    if (opts.wet) {
      const w = ctx.createGain();
      w.gain.value = opts.wet;
      g.connect(w).connect(this.reverbSend);
    }
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  private noiseBurst(dur: number, opts: { type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; gain?: number; delay?: number; attack?: number; wet?: number; kind?: string; bus?: "sfx" | "ambience" } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise[opts.kind ?? "white"];
    src.loop = true; // long bursts (thunder rolls) outlast the noise buffers
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.setValueAtTime(opts.freq ?? 1000, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t0, opts.attack ?? 0.005, opts.gain ?? 0.2, dur);
    src.connect(f).connect(g);
    g.connect(opts.bus === "ambience" ? this.ambience : this.sfx);
    if (opts.wet) {
      const w = ctx.createGain();
      w.gain.value = opts.wet;
      g.connect(w).connect(this.reverbSend);
    }
    src.start(t0, Math.random() * 2);
    src.stop(t0 + dur + 0.2);
  }

  click(): void {
    this.tone(1800, 0.04, { type: "square", gain: 0.03 });
    this.tone(900, 0.06, { gain: 0.05, delay: 0.005 });
  }

  tick(): void {
    this.tone(2400 + Math.random() * 400, 0.015, { type: "square", gain: 0.006 });
  }

  confirm(): void {
    this.tone(659.25, 0.35, { gain: 0.07, wet: 0.5 });
    this.tone(987.77, 0.6, { gain: 0.06, delay: 0.09, wet: 0.6 });
  }

  deny(): void {
    this.tone(220, 0.12, { type: "square", gain: 0.035 });
    this.tone(196, 0.16, { type: "square", gain: 0.03, delay: 0.13 });
  }

  breaker(): void {
    // Cover flip, then heavy mechanical clunk with a low body thump.
    this.noiseBurst(0.05, { type: "highpass", freq: 3000, gain: 0.25 });
    this.noiseBurst(0.18, { type: "lowpass", freq: 900, gain: 0.6, delay: 0.35, kind: "brown", wet: 0.4 });
    this.tone(60, 0.35, { gain: 0.5, delay: 0.35, slide: 0.6 });
    this.noiseBurst(0.04, { type: "highpass", freq: 5000, gain: 0.3, delay: 0.36 });
  }

  powerUp(): void {
    // Rising transformer whine + relay clicks.
    this.tone(40, 2.2, { type: "sawtooth", gain: 0.05, slide: 3.5, attack: 0.8, wet: 0.3 });
    this.tone(120, 2.0, { gain: 0.06, slide: 4, attack: 1.2 });
    for (let i = 0; i < 7; i++) {
      this.noiseBurst(0.03, { type: "highpass", freq: 4000, gain: 0.08 + Math.random() * 0.1, delay: 0.4 + i * 0.22 + Math.random() * 0.1, wet: 0.3 });
    }
  }

  lightFlicker(): void {
    this.noiseBurst(0.08, { type: "bandpass", freq: 120, q: 4, gain: 0.25 });
    this.tone(100, 0.08, { type: "square", gain: 0.03 });
  }

  lightOn(): void {
    this.noiseBurst(0.03, { type: "highpass", freq: 3500, gain: 0.12, wet: 0.4 });
    this.tone(100, 0.3, { type: "triangle", gain: 0.03 });
  }

  boot(): void {
    // Computer boot: soft arpeggio + data chatter.
    const notes = [293.66, 440, 587.33, 880];
    notes.forEach((n, i) => this.tone(n, 0.5, { gain: 0.045, delay: i * 0.11, wet: 0.5 }));
    for (let i = 0; i < 16; i++) this.tone(1500 + Math.random() * 3000, 0.02, { type: "square", gain: 0.01, delay: 0.5 + i * 0.05 });
  }

  whoosh(dur = 1.6): void {
    this.noiseBurst(dur, { type: "bandpass", freq: 200, freqEnd: 2400, q: 0.8, gain: 0.18, attack: dur * 0.6, kind: "pink", wet: 0.5 });
  }

  glitch(amount = 1): void {
    const n = 4 + Math.floor(amount * 6);
    for (let i = 0; i < n; i++) {
      this.tone(80 + Math.random() * 2000, 0.03 + Math.random() * 0.05, { type: "square", gain: 0.02 * amount, delay: Math.random() * 0.35 });
    }
    this.noiseBurst(0.25, { type: "bandpass", freq: 3000, q: 6, gain: 0.08 * amount });
  }

  /**
   * Thunder arrives after the flash, like in reality: sound travels ~343 m/s, so
   * the delay grows with distance (compressed a little to keep the pacing).
   * Close strikes crack first and then roll; distant ones are only a low roll.
   * `distance`: 0 = right outside, 1 = far away.
   */
  thunder(distance = 0.6): void {
    const d = Math.max(0, Math.min(1, distance));
    const km = 0.25 + d * 3.5;
    const delay = Math.min(7, (km * 1000) / 343) * 0.6 + 0.15;
    const near = 1 - d;
    // Crack: bright, very short, only for close strikes.
    if (near > 0.35) {
      this.noiseBurst(0.08, { type: "highpass", freq: 1200, gain: 0.35 * near, kind: "white", delay, bus: "ambience", wet: 0.3 });
      this.noiseBurst(0.35, { type: "bandpass", freq: 900, freqEnd: 300, q: 0.7, gain: 0.3 * near, kind: "pink", delay: delay + 0.03, attack: 0.01, bus: "ambience", wet: 0.5 });
    }
    // Roll: several overlapping low bursts at irregular offsets = rumble that tumbles.
    const parts = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < parts; i++) {
      const off = delay + 0.1 + i * (0.35 + Math.random() * 0.7) + d * 0.3;
      const dur = 1.6 + Math.random() * 2.2 + d * 1.5;
      this.noiseBurst(dur, {
        type: "lowpass",
        freq: 320 - d * 170 + Math.random() * 80,
        freqEnd: 60 + Math.random() * 30,
        gain: (0.55 - i * 0.07) * (0.7 + near * 0.5),
        attack: 0.08 + d * 0.5 + Math.random() * 0.2,
        kind: "brown",
        delay: off,
        bus: "ambience",
        wet: 0.55,
      });
    }
  }

  drip(): void {
    const f = 900 + Math.random() * 500;
    this.tone(f, 0.09, { gain: 0.035, slide: 1.8, wet: 0.7 });
  }

  servo(): void {
    this.tone(180, 0.7, { type: "sawtooth", gain: 0.02, slide: 1.6, attack: 0.1 });
    this.noiseBurst(0.7, { type: "bandpass", freq: 1200, freqEnd: 1800, q: 3, gain: 0.04, attack: 0.1 });
  }

  scan(): void {
    this.tone(300, 2.4, { gain: 0.04, slide: 4, attack: 0.6, wet: 0.7 });
    this.tone(303, 2.4, { gain: 0.03, slide: 4.1, attack: 0.6, wet: 0.7 });
  }

  fragment(index: number): void {
    const base = [523.25, 659.25, 783.99, 1046.5][index % 4];
    this.tone(base, 1.6, { gain: 0.06, wet: 0.9, attack: 0.01 });
    this.tone(base * 2.005, 1.2, { gain: 0.025, wet: 0.9, delay: 0.02 });
    this.tone(base * 1.5, 1.4, { gain: 0.03, wet: 0.9, delay: 0.12 });
  }

  doorUnlock(): void {
    this.noiseBurst(0.06, { type: "highpass", freq: 2500, gain: 0.3, wet: 0.3 });
    this.tone(70, 0.4, { gain: 0.4, delay: 0.05, slide: 0.7 });
    this.tone(523.25, 0.4, { gain: 0.05, delay: 0.3, wet: 0.5 });
    this.tone(783.99, 0.7, { gain: 0.05, delay: 0.42, wet: 0.6 });
  }

  doorSlide(): void {
    this.noiseBurst(2.2, { type: "lowpass", freq: 400, freqEnd: 250, gain: 0.25, attack: 0.3, kind: "brown", wet: 0.3 });
    this.tone(55, 2.0, { type: "sawtooth", gain: 0.03, attack: 0.3 });
  }

  laptopChime(): void {
    [392, 493.88, 587.33].forEach((f, i) => this.tone(f, 1.5, { gain: 0.04, delay: i * 0.18, wet: 0.8, attack: 0.02 }));
  }

  /** Periodic scheduling for traffic swells and drips. Call once per frame. */
  update(dt: number): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    this.trafficTimer -= dt;
    if (this.trafficTimer <= 0) {
      this.trafficTimer = 5 + Math.random() * 9;
      const lvl = this.cityBed.gain.gain.value;
      if (lvl > 0.02) {
        this.noiseBurst(3 + Math.random() * 2, {
          type: "bandpass",
          freq: 300 + Math.random() * 300,
          freqEnd: 180,
          q: 1.5,
          gain: 0.06 + lvl * 0.2,
          attack: 1.4,
          kind: "pink",
          bus: "ambience",
        });
      }
    }
    if (this.drips) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 1.3 + Math.random() * 1.8;
        this.drip();
      }
    }
  }

  /** Exact drip sync with the visual drip in the observation room. */
  dripNow(): void {
    this.drip();
  }

  reset(): void {
    this.setPad("silent", 0, 1);
    this.setSignal(0);
    this.setHum(0);
    this.setMuffle(0);
    this.drips = false;
  }
}
