import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--enable-features=Vulkan", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
await page.goto("http://localhost:5173/src/config.ts");
console.log(await page.evaluate(async () => { if (!navigator.gpu) return "no navigator.gpu"; const a = await navigator.gpu.requestAdapter(); if (!a) return "no adapter"; const d = await a.requestDevice(); return "ok " + (a.info ? a.info.vendor + " " + a.info.architecture + " " + a.info.description : ""); }));
await browser.close();
