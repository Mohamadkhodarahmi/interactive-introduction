import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs: works on Vercel (root) and GitHub Pages (/interactive-introduction/).
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/gsap")) return "gsap";
          return undefined;
        },
      },
    },
  },
  server: { host: true },
});
