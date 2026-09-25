import { chromium } from "playwright-core";
const [w = "390", h = "844"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: [...(process.env.GPU ? ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan"] : []), "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, hasTouch: +w < 600, isMobile: +w < 600 });
if (process.env.GPU) await page.addInitScript(() => { if (!self.GPUTexture) return; const o = GPUTexture.prototype.createView; GPUTexture.prototype.createView = function (d) { if (d && "swizzle" in d) { d = { ...d }; delete d.swizzle; } return o.call(this, d); }; });
page.on("console", (m) => { const t = m.text(); if (!t.includes("vite") && !t.includes("Instance") && !t.includes("GL Driver")) console.log(`[${m.type()}] ${t.slice(0, 500)}`); });
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto("http://localhost:5173/", { waitUntil: "commit", timeout: 180000 });
await page.waitForFunction(() => window.__app, null, { timeout: 300000 });
const btn = page.locator("button", { hasText: "شروع" }).first();
await btn.waitFor({ state: "visible", timeout: 120000 }); await page.waitForTimeout(800); await btn.click();
for (let i = 0; i < 60; i++) {
  const p = await page.evaluate(() => { const it = window.__app.ctx.interactor; const hh = it.get("breaker"); return hh && hh.enabled ? it.screenPos("breaker") : null; });
  if (p) { await page.mouse.click(p.x, p.y); console.log("tapped"); break; }
  await page.waitForTimeout(500);
}
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(5000);
  console.log(await page.evaluate(() => { const a = window.__app; return JSON.stringify({ s: a.ctx.store.get().currentScene, cam: a.ctx.cameras.current, sys: [...document.querySelectorAll(".sys .line")].map((l) => l.textContent).join("|"), say: document.querySelector(".say").textContent, btns: [...document.querySelectorAll(".actions .btn")].map((b) => b.textContent + ":" + getComputedStyle(b).opacity) }); }));
}
await browser.close();
