// Screenshots the inline loader with the app bundle blocked. Usage: node scripts/loader-shot.mjs [url]
import { chromium } from "playwright-core";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const url = process.argv[2] ?? "http://localhost:5173/";
const shots = [["phone", 390, 844, 2500], ["phone2", 390, 844, 9500], ["phone3", 390, 844, 16500], ["desk", 1440, 900, 3000]];
for (const [name, w, h, t] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.route(/main\.ts|index-.*\.js/, (r) => r.abort());
  await p.goto(url, { waitUntil: "commit" });
  await p.waitForTimeout(t);
  await p.screenshot({ path: `/tmp/claude-0/ld-${name}.png`, timeout: 60000 });
  console.log(name);
  await p.close();
}
await b.close();
