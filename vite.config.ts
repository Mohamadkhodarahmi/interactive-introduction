import { defineConfig } from "vite";

export default defineConfig({
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
