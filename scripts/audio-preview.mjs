// Render the rain + thunder mix offline in Chromium and save a WAV for listening/analysis.
// Usage: node scripts/audio-preview.mjs out.wav
import { chromium } from "playwright-core";
import fs from "fs";
const out = process.argv[2] ?? "/tmp/claude-0/preview.wav";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("http://localhost:5173/src/config.ts", { waitUntil: "commit" });
const b64 = await page.evaluate(async () => {
  const { AudioEngine } = await import("/src/audio/AudioEngine.ts");
  const sr = 44100, secs = 22;
  const off = new OfflineAudioContext(2, sr * secs, sr);
  const e = new AudioEngine();
  e.ctx = off;
  e.build(off);
  await Promise.all(e.rainReady);
  e.setRain(0.55, 0.15, 0.1);   // indoor, powered room level
  e.setCity(0.65, 0.1);
  e.thunder(0.25);              // close strike at t=0 (flash)
  const buf = await (async () => {
    // A far strike at ~11 s: schedule by suspending the offline context.
    off.suspend(11).then(() => { e.thunder(0.85); off.resume(); });
    return off.startRendering();
  })();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const n = L.length, bytes = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o, s) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); bytes.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt ");
  bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
  bytes.setUint32(24, sr, true); bytes.setUint32(28, sr * 4, true); bytes.setUint16(32, 4, true); bytes.setUint16(34, 16, true);
  w(36, "data"); bytes.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    bytes.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    bytes.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  let s = ""; const u8 = new Uint8Array(bytes.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
});
fs.writeFileSync(out, Buffer.from(b64, "base64"));
console.log("wrote", out);
await browser.close();
