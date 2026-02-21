import { defineConfig, type HtmlTagDescriptor, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { autoI18nPlugin } from "./client/vite.plugins/autoI18n";

const buildHash = process.env.BUILD_HASH ?? Date.now().toString(36);
const DEFAULT_VENDOR_CHUNK_MAX_BYTES = 1_400_000;
const CRITICAL_ROUTE_MODULE_SUFFIXES = [
  "/client/src/pages/QuotesScreen.tsx",
  "/client/src/pages/TradeScreen.tsx",
  "/client/src/pages/ChartScreen.tsx",
] as const;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function isCriticalRouteModuleId(moduleId: string | null | undefined): boolean {
  if (!moduleId) return false;
  const normalized = normalizePath(moduleId);
  return CRITICAL_ROUTE_MODULE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function criticalRouteModulePreloadPlugin(): Plugin {
  return {
    name: "critical-route-modulepreload",
    apply: "build" as const,
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;

        const preloadHrefs = new Set<string>();
        const visitedFiles = new Set<string>();

        const includeChunkAndImports = (fileName: string) => {
          if (visitedFiles.has(fileName)) return;
          visitedFiles.add(fileName);
          const chunk = bundle[fileName];
          if (!chunk || chunk.type !== "chunk") return;
          preloadHrefs.add(`/${chunk.fileName}`);
          for (const importedFile of chunk.imports || []) {
            includeChunkAndImports(importedFile);
          }
        };

        for (const artifact of Object.values(bundle)) {
          if (!artifact || artifact.type !== "chunk") continue;
          if (!isCriticalRouteModuleId(artifact.facadeModuleId)) continue;
          includeChunkAndImports(artifact.fileName);
        }

        if (!preloadHrefs.size) return html;
        const tags: HtmlTagDescriptor[] = Array.from(preloadHrefs)
          .sort()
          .filter((href) => !html.includes(`href="${href}"`) && !html.includes(`src="${href}"`))
          .map((href) => ({
            tag: "link",
            attrs: {
              rel: "modulepreload",
              href,
            },
            injectTo: "head" as const,
          }));

        if (!tags.length) return html;
        return {
          html,
          tags,
        };
      },
    },
  };
}

function resolveVendorChunkMaxBytes(): number {
  const raw = Number(process.env.VITE_VENDOR_CHUNK_MAX_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_VENDOR_CHUNK_MAX_BYTES;
  return Math.round(raw);
}

function resolvePackageNameFromModuleId(moduleId: string): string | null {
  const marker = "/node_modules/";
  const firstNodeModulesIdx = moduleId.lastIndexOf(marker);
  if (firstNodeModulesIdx < 0) return null;

  let remainder = moduleId.slice(firstNodeModulesIdx + marker.length);
  const nestedNodeModulesIdx = remainder.lastIndexOf(marker);
  if (nestedNodeModulesIdx >= 0) {
    remainder = remainder.slice(nestedNodeModulesIdx + marker.length);
  }

  if (remainder.startsWith("@")) {
    const [scope, name] = remainder.split("/");
    if (scope && name) return `${scope}/${name}`;
  }
  const [name] = remainder.split("/");
  return name || null;
}

function resolveVendorChunkName(moduleId: string): string {
  const packageName = resolvePackageNameFromModuleId(moduleId);
  if (!packageName) return "vendor";
  if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") {
    return "react-vendor";
  }
  if (packageName.startsWith("@tanstack/")) return "tanstack-vendor";
  if (
    packageName.startsWith("@radix-ui/") ||
    packageName === "class-variance-authority" ||
    packageName === "clsx"
  ) {
    return "ui-vendor";
  }
  if (packageName === "zod") return "schema-vendor";
  if (packageName.startsWith("@sentry/")) return "observability-vendor";
  return "vendor";
}

function vendorChunkGuardPlugin(maxBytes: number): Plugin {
  return {
    name: "vendor-chunk-guard",
    apply: "build" as const,
    generateBundle(_options, bundle) {
      for (const artifact of Object.values(bundle)) {
        if (!artifact || artifact.type !== "chunk") continue;
        if (typeof artifact.fileName !== "string" || !artifact.fileName.includes("vendor")) continue;
        const code = typeof artifact.code === "string" ? artifact.code : "";
        const bytes = Buffer.byteLength(code, "utf8");
        if (bytes > maxBytes) {
          this.error(
            `Vendor chunk "${artifact.fileName}" is ${bytes} bytes (max ${maxBytes}). ` +
            `Adjust manualChunks or set VITE_VENDOR_CHUNK_MAX_BYTES.`,
          );
        }
      }
    },
  };
}

export default defineConfig({
  define: {
    __TQ_BUILD_HASH__: JSON.stringify(buildHash),
  },
  plugins: [
    autoI18nPlugin(),
    react(),
    runtimeErrorOverlay(),
    criticalRouteModulePreloadPlugin(),
    vendorChunkGuardPlugin(resolveVendorChunkMaxBytes()),
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
            normalizedId.includes("node_modules/recharts") ||
            normalizedId.includes("node_modules/d3")
          ) {
            return "charts-vendor";
          }
          if (normalizedId.includes("node_modules")) {
            return resolveVendorChunkName(normalizedId);
          }
          return undefined;
        },
      },
    },
  },
});
