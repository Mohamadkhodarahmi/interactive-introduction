// Screenshot a WebGPU canvas in headless Chromium (canvas readback right after a render).
import { chromium } from "playwright-core";
import fs from "fs";
const [url, out, waitMs = "40000", w = "1280", h = "720", js = ""] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.addInitScript(() => {
  if (!self.GPUTexture) return;
  const orig = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (d) { if (d && "swizzle" in d) { d = { ...d }; delete d.swizzle; } return orig.call(this, d); };
});
const logs = [];
page.on("console", (m) => { const t = m.text(); if (!t.includes("vite") && !t.includes("Instance")) logs.push(`[${m.type()}] ${t.slice(0, 400)}`); });
page.on("pageerror", (e) => { if (!e.message.includes("Instance")) logs.push(`[pageerror] ${e.message}`); });
await page.goto(url, { waitUntil: "commit", timeout: 180000 });
await page.waitForFunction(() => window.__app, null, { timeout: 300000 });
await page.waitForTimeout(+waitMs);
if (js) await page.evaluate(js);
const data = await page.evaluate(() => new Promise((resolve) => {
  const post = window.__app.ctx.post;
  const orig = post.render.bind(post);
  post.render = () => { orig(); post.render = orig; resolve(window.__app.ctx.renderer.domElement.toDataURL("image/png")); };
}));
fs.writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
console.log(logs.slice(0, 30).join("\n"));
console.log("gpu:", await page.evaluate(() => window.__app.ctx.isWebGPU));
await browser.close();
