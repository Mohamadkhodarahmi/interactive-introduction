// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [w] [h] [evalJs]
import { chromium } from "playwright-core";
const [url, out, waitMs = "4000", w = "1280", h = "720", js = ""] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: "commit", timeout: 180000 });
await page.waitForTimeout(+waitMs);
if (js) { await page.evaluate(js); await page.waitForTimeout(1500); }
await page.screenshot({ path: out, timeout: 150000 });
console.log(logs.slice(0, 40).join("\n"));
console.log("ok:", await page.evaluate(() => window.__ok));
await browser.close();
