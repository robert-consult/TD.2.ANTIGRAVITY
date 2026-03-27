import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

const pluginDir = path.dirname(fileURLToPath(import.meta.url));
const virtualNamespace = "tradehub-headlamp-virtual";

const materialExports = [
  "Alert",
  "Box",
  "Chip",
  "Grid",
  "LinearProgress",
  "Link",
  "Paper",
  "Table",
  "TableBody",
  "TableCell",
  "TableContainer",
  "TableHead",
  "TableRow",
  "Typography",
];

const virtualModules = {
  "@kinvolk/headlamp-plugin/lib": `
    const pluginLib = window.pluginLib ?? {};
    export const registerRoute = pluginLib.registerRoute;
    export const registerSidebarEntry = pluginLib.registerSidebarEntry;
    export const registerSidebarEntryFilter = pluginLib.registerSidebarEntryFilter;
    export const registerOverviewChartsProcessor = pluginLib.registerOverviewChartsProcessor;
    export const K8s = pluginLib.K8s;
    export default pluginLib;
  `,
  "@kinvolk/headlamp-plugin/lib/CommonComponents": `
    const commonComponents = window.pluginLib?.CommonComponents ?? {};
    export const SectionBox = commonComponents.SectionBox;
    export const TileChart = commonComponents.TileChart;
    export default commonComponents;
  `,
  "@mui/material": `
    const material = window.MUI ?? window.pluginLib?.MUI ?? {};
    ${materialExports.map((name) => `export const ${name} = material.${name};`).join("\n")}
    export default material;
  `,
  react: `
    const React = window.React ?? window.pluginLib?.React;
    export const Fragment = React?.Fragment;
    export const createElement = React?.createElement;
    export default React;
  `,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await mkdir(path.join(pluginDir, "dist"), { recursive: true });

await build({
  entryPoints: [path.join(pluginDir, "src/index.tsx")],
  outfile: path.join(pluginDir, "dist/main.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  tsconfigRaw: {
    compilerOptions: {
      jsx: "react",
      jsxFactory: "React.createElement",
      jsxFragmentFactory: "React.Fragment",
    },
  },
  banner: {
    js: `/**
 * TradeHub Petascale Ops — Headlamp Plugin Bundle
 *
 * Built from ops/headlamp-plugin/src/index.tsx with repo-local esbuild shims
 * so the runtime uses Headlamp's browser globals instead of a stale CLI.
 */`,
  },
  plugins: [
    {
      name: "tradehub-headlamp-globals",
      setup(esbuild) {
        for (const moduleName of Object.keys(virtualModules)) {
          esbuild.onResolve({ filter: new RegExp(`^${escapeRegExp(moduleName)}$`) }, () => ({
            path: moduleName,
            namespace: virtualNamespace,
          }));
        }

        esbuild.onLoad({ filter: /.*/, namespace: virtualNamespace }, (args) => ({
          contents: virtualModules[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
