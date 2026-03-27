import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();
const RUNTIME_ERROR_PREFIX = "[RUNTIME_ERROR]";

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Browser runtime overlay events should not terminate the Node dev server.
        if (msg.startsWith(RUNTIME_ERROR_PREFIX)) return;
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  // Express 5 (path-to-regexp) no longer accepts "*" as a path pattern.
  // Omitting the path matches all remaining requests (catch-all).
  app.use(async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const candidateRoots = [
    // Standard output from `vite build` (see package.json `build`).
    path.resolve(process.cwd(), "dist", "public"),
    // If running from within `dist/`.
    path.resolve(process.cwd(), "public"),
    // Legacy behavior (relative to this module's directory).
    path.resolve(import.meta.dirname, "public"),
  ];

  const distPath =
    candidateRoots.find((p) => fs.existsSync(path.resolve(p, "index.html"))) ??
    candidateRoots[0];

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt"]);

  const setStaticHeaders = (res: any, urlPath: string) => {
    res.setHeader("Vary", "Accept-Encoding");
    if (urlPath.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return;
    }
    if (urlPath === "/sw.js") {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
  };

  // Serve precompressed assets when present (Brotli preferred over gzip).
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const urlPath = req.path || "/";
    const ext = path.extname(urlPath).toLowerCase();
    if (!textExtensions.has(ext)) return next();

    const accept = String(req.headers["accept-encoding"] || "");
    if (!accept) return next();

    let absPath: string;
    try {
      absPath = path.resolve(distPath, "." + urlPath);
    } catch {
      return next();
    }
    if (!absPath.startsWith(distPath)) return next();
    if (!fs.existsSync(absPath)) return next();

    const contentTypeExt = ext.startsWith(".") ? ext.slice(1) : ext;
    if (accept.includes("br") && fs.existsSync(absPath + ".br")) {
      setStaticHeaders(res, urlPath);
      res.setHeader("Content-Encoding", "br");
      res.type(contentTypeExt);
      return res.sendFile(absPath + ".br");
    }
    if (accept.includes("gzip") && fs.existsSync(absPath + ".gz")) {
      setStaticHeaders(res, urlPath);
      res.setHeader("Content-Encoding", "gzip");
      res.type(contentTypeExt);
      return res.sendFile(absPath + ".gz");
    }
    next();
  });

  const assetsDir = path.resolve(distPath, "assets");
  if (fs.existsSync(assetsDir)) {
    app.use(
      "/assets",
      express.static(assetsDir, {
        immutable: true,
        maxAge: "1y",
        setHeaders: (res) => {
          res.setHeader("Vary", "Accept-Encoding");
        },
      }),
    );
  }

  app.use(
    express.static(distPath, {
      maxAge: 0,
      setHeaders: (res, filePath) => {
        const rel = "/" + path.relative(distPath, filePath).replaceAll(path.sep, "/");
        setStaticHeaders(res, rel === "/index.html" ? "/index.html" : rel);
      },
    }),
  );

  // fall through to index.html if the file doesn't exist
  // Express 5 (path-to-regexp) no longer accepts "*" as a path pattern.
  // Omitting the path matches all remaining requests (catch-all).
  app.use((req, res) => {
    if (req.path === "/sw.js") {
      setStaticHeaders(res, "/sw.js");
      return res.status(404).end();
    }

    const accept = String(req.headers["accept-encoding"] || "");
    const indexPath = path.resolve(distPath, "index.html");
    if (accept.includes("br") && fs.existsSync(indexPath + ".br")) {
      setStaticHeaders(res, "/index.html");
      res.setHeader("Content-Encoding", "br");
      res.type("html");
      return res.sendFile("index.html.br", { root: distPath });
    }
    if (accept.includes("gzip") && fs.existsSync(indexPath + ".gz")) {
      setStaticHeaders(res, "/index.html");
      res.setHeader("Content-Encoding", "gzip");
      res.type("html");
      return res.sendFile("index.html.gz", { root: distPath });
    }
    setStaticHeaders(res, "/index.html");
    // Express 5 + Windows: `res.sendFile(absolutePath)` can incorrectly 404.
    // Using `root` + relative path avoids the issue.
    res.sendFile("index.html", { root: distPath });
  });
}
