import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8600",
        changeOrigin: true,
        configure: (proxy) => {
          // Forward SSE headers immediately (otherwise the dev proxy waits for the first event/ping).
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (String(proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              setTimeout(() => res.flushHeaders(), 0);
            }
          });
        },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
