// Full story playthrough in headless Chromium. Usage: node scripts/playthrough.mjs <branch> [w] [h] [outDir]
import { chromium } from "playwright-core";
import fs from "fs";
const [branch = "investigate", w = "1280", h = "720", out = "/tmp/claude-0/qa"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, hasTouch: +w < 600, isMobile: +w < 600 });
const logs = [];
page.on("console", (m) => { const t = m.text(); if (!t.includes("vite") && !t.includes("GL Driver")) logs.push(`[${m.type()}] ${t.slice(0, 300)}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);
let n = 0;
const shot = async (name) => { await page.screenshot({ path: `${out}/${String(n++).padStart(2, "0")}-${name}.png` }); log("shot " + name); };
const clickText = async (text, timeout = 90000) => {
  const loc = page.locator("button, a", { hasText: text }).first();
  await loc.waitFor({ state: "visible", timeout });
  await page.waitForTimeout(900);
  await loc.click();
  log("clicked " + text);
};
const tapHotspot = async (id, timeout = 60000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const p = await page.evaluate((id) => { const i = window.__app?.ctx.interactor; const h = i?.get(id); return h && h.enabled ? i.screenPos(id) : null; }, id);
    if (p) { await page.mouse.click(p.x, p.y); log("tapped " + id); return; }
    await page.waitForTimeout(500);
  }
  throw new Error("hotspot never enabled: " + id);
};
const scene = () => page.evaluate(() => window.__app?.ctx.store.get().currentScene);
const waitScene = async (s, timeout = 120000) => { const st = Date.now(); while (Date.now() - st < timeout) { if ((await scene()) === s) return; await page.waitForTimeout(400); } throw new Error("scene timeout " + s); };
try {
  await page.goto("http://localhost:5173/", { waitUntil: "load" });
  await page.waitForTimeout(9000);
  await shot("arrival");
  await clickText("شروع");
  await page.waitForTimeout(3000);
  await shot("power-prompt");
  await tapHotspot("breaker");
  await page.waitForTimeout(4000);
  await shot("power-on");
  const label = { approach: "نزدیک‌تر", investigate: "بررسیش", ignore: "بی‌خیالش" }[branch];
  await page.locator("button", { hasText: label }).first().waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(1200);
  await shot("signal-choice");
  await clickText(label);
  await page.waitForTimeout(5000);
  await shot("branch-" + branch);
  await waitScene("memory");
  await page.waitForTimeout(3000);
  await shot("corrupted");
  for (const id of ["frag0", "frag1", "frag2"]) { await tapHotspot(id, 90000); await page.waitForTimeout(2500); }
  await shot("memory-restored");
  await waitScene("analysis", 120000);
  await page.waitForTimeout(6000);
  await shot("analysis");
  await page.locator("#name-input").waitFor({ state: "visible", timeout: 120000 });
  await page.fill("#name-input", "سارا");
  await shot("identity");
  await clickText("ادامه");
  await page.waitForTimeout(6000);
  await shot("door-warm");
  await waitScene("final", 60000);
  await page.waitForTimeout(9000);
  await shot("final-room");
  await waitScene("reveal", 90000);
  await page.waitForTimeout(6000);
  await shot("reveal");
  await clickText("راه ارتباطی من", 120000);
  await page.waitForTimeout(1500);
  await shot("contact");
  await clickText("ادامه");
  await clickText("دوباره شروع کن", 60000);
  await shot("end");
  await page.waitForTimeout(8000);
  const st = await page.evaluate(() => JSON.stringify(window.__app.ctx.store.get()));
  log("after replay state: " + st);
  await shot("replayed");
} catch (e) {
  log("FAIL " + e.message);
  await shot("fail");
}
console.log(logs.slice(0, 40).join("\n"));
await browser.close();
