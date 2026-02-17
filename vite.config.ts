import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { autoI18nPlugin } from "./client/vite.plugins/autoI18n";

const buildHash = process.env.BUILD_HASH ?? Date.now().toString(36);

export default defineConfig({
  define: {
    __TQ_BUILD_HASH__: JSON.stringify(buildHash),
  },
  plugins: [
    autoI18nPlugin(),
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
      ? [
        await import("@replit/vite-plugin-cartographer").then((m) =>
          m.cartographer(),
        ),
      ]
      : []),
  ],
  resolve: {
    alias: {
      "@db": path.resolve(import.meta.dirname, "db"),
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    manifest: true,
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "client/index.html"),
        sw: path.resolve(import.meta.dirname, "client/src/sw.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
        manualChunks: (id) => {
          const normalizedId = id.replace(/\\/g, "/");
          if (
            normalizedId.includes("/src/pages/AdminDashboard") ||
            normalizedId.includes("/src/components/admin/")
          ) {
            return "admin";
          }
          if (
            normalizedId.includes("node_modules/recharts") ||
            normalizedId.includes("node_modules/d3")
          ) {
            return "charts-vendor";
          }
          if (normalizedId.includes("node_modules")) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
});
