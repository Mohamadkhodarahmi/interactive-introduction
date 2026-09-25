import { chromium } from "playwright-core";
const [url, waitMs = "8000", js = "0"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: [...(process.env.GPU ? ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan"] : []), "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// QA-only: this headless Chromium predates the string form of GPUTextureViewDescriptor.swizzle.
if (process.env.GPU) await page.addInitScript(() => {
  if (!self.GPUTexture) return;
  const orig = GPUTexture.prototype.createView;
  GPUTexture.prototype.createView = function (d) {
    if (d && "swizzle" in d) { d = { ...d }; delete d.swizzle; }
    return orig.call(this, d);
  };
});
const logs = [];
page.on("console", (m) => { if (!m.text().includes("vite")) logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "commit", timeout: 180000 });
await page.waitForTimeout(+waitMs);
console.log(await page.evaluate(js));
console.log(logs.filter((l) => !l.includes("Instance") && !l.includes("GL Driver")).slice(0, 40).join("\n"));
await browser.close();
