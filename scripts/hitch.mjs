// Measure frame hitches around power restore. GPU=1 for WebGPU.
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: [...(process.env.GPU ? ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan"] : []), "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
if (process.env.GPU) await page.addInitScript(() => { if (!self.GPUTexture) return; const o = GPUTexture.prototype.createView; GPUTexture.prototype.createView = function (d) { if (d && "swizzle" in d) { d = { ...d }; delete d.swizzle; } return o.call(this, d); }; });
await page.goto("http://localhost:5173/" + (process.env.Q ? "?quality=" + process.env.Q : ""), { waitUntil: "commit", timeout: 180000 });
await page.waitForFunction(() => window.__app, null, { timeout: 300000 });
const btn = page.locator("button", { hasText: "شروع" }).first();
await btn.waitFor({ state: "visible", timeout: 120000 }); await page.waitForTimeout(800); await btn.click();
await page.waitForTimeout(3000);
const base = await page.evaluate(() => { const a = window.__app.app; const h = a.hitches.slice(); a.hitches.length = 0; return h; });
console.log("before breaker:", JSON.stringify(base));
for (let i = 0; i < 80; i++) {
  const p = await page.evaluate(() => { const it = window.__app.ctx.interactor; const hh = it.get("breaker"); return hh && hh.enabled ? it.screenPos("breaker") : null; });
  if (p) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); const still = await page.evaluate(() => window.__app.ctx.interactor.get("breaker")?.enabled); if (!still) break; }
  else await page.waitForTimeout(500);
}
const t0 = await page.evaluate(() => performance.now());
await page.waitForTimeout(20000);
const res = await page.evaluate(() => ({ h: window.__app.app.hitches, fps: window.__app.app.dpr.fps, p: window.__app.ctx.store.get().powerRestored, s: window.__app.ctx.store.get().currentScene }));
console.log("power", res.p, res.s, await page.evaluate(() => location.href + " gpu=" + window.__app.ctx.isWebGPU));
console.log("tap at", Math.round(t0), "fps", res.fps.toFixed(1));
console.log(res.h.map((x) => `+${x.t - Math.round(t0)}ms ${x.ms}ms ${x.scene}`).join("\n"));
await browser.close();
