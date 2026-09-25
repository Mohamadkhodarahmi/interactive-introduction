import "@fontsource/vazirmatn/300.css";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "./ui/styles.css";
import gsap from "gsap";
import { App } from "./core/App";

// Story timing must follow wall-clock time even when a frame hitches.
gsap.ticker.lagSmoothing(0);

new App().start().catch((err) => {
  console.error("[boot]", err);
});
