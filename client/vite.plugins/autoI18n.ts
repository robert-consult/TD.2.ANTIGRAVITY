import type { Plugin, ResolvedConfig } from "vite";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import MagicString from "magic-string";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

type ManifestEntry = {
  id: string;
  defaultText: string;
  file: string;
  line?: number;
  column?: number;
  kind: "JSXText" | "JSXAttr" | "ObjectProp" | "JSXExpr";
  propName?: string;
};

const traverse: typeof import("@babel/traverse").default = (traverseModule as any).default ?? (traverseModule as any);

const TRANSLATABLE_JSX_ATTRS = new Set([
  "label",
  "title",
  "placeholder",
  "alt",
  "aria-label",
  "ariaLabel",
  "tooltip",
  "helpText",
  "description",
  "emptyText",
  "header",
]);

const TRANSLATABLE_OBJECT_KEYS = new Set([
  "title",
  "titleOverride",
  "description",
  "label",
  "shortLabel",
  "badge",
  "placeholder",
  "emptyText",
  "header",
  "text",
]);

function looksTranslatable(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(\{\{[a-zA-Z0-9_]+\}\}|\{[a-zA-Z0-9_]+\}|%\{[a-zA-Z0-9_]+\}|\$\{[a-zA-Z0-9_.]+\})$/.test(t)) return false;
  if (/^(https?:\/\/|\/{1,2})/i.test(t)) return false;
  if (/^[A-Z0-9_\-]{1,6}$/.test(t)) return false; // likely token/symbol
  if (!/[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF]/.test(t)) return false;
  return true;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stableId(params: { file: string; kind: ManifestEntry["kind"]; text: string; propName?: string }): string {
  const base = `${params.file}::${params.kind}::${params.propName ?? ""}::${params.text}`;
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

function nodeLoc(node: any): { line?: number; column?: number } {
  const loc = node?.loc?.start;
  if (!loc) return {};
  return { line: loc.line, column: loc.column };
}

function stringLikeText(node: any): { raw: string; text: string } | null {
  if (!node) return null;
  if (node.type === "StringLiteral") {
    const raw = String(node.value ?? "");
    return { raw, text: normalizeText(raw) };
  }
  if (node.type === "TemplateLiteral") {
    if (Array.isArray(node.expressions) && node.expressions.length) return null;
    const raw = String(node.quasis?.map((q: any) => q?.value?.cooked ?? "").join("") ?? "");
    return { raw, text: normalizeText(raw) };
  }
  return null;
}

function jsxAttributeName(node: any): string {
  const nameNode = node?.name;
  if (nameNode?.type === "JSXIdentifier") return String(nameNode.name);
  if (nameNode?.type === "JSXNamespacedName") {
    return `${nameNode.namespace?.name}:${nameNode.name?.name}`;
  }
  return "";
}

function jsxExpressionContainerContext(exprPath: any): { propName?: string } | null {
  const parent = exprPath?.parentPath;
  if (!parent) return null;
  if (parent.node?.type === "JSXAttribute") {
    const name = jsxAttributeName(parent.node);
    if (!TRANSLATABLE_JSX_ATTRS.has(name)) return null;
    return { propName: name };
  }
  if (parent.node?.type === "JSXElement" || parent.node?.type === "JSXFragment") return {};
  return null;
}

function findJsxExpressionContext(path: any): { propName?: string } | null {
  if (path?.node?.type === "JSXExpressionContainer") return jsxExpressionContainerContext(path);
  const expr = path.findParent((pp: any) => pp?.node?.type === "JSXExpressionContainer");
  if (!expr) return null;
  return jsxExpressionContainerContext(expr);
}

function renderTrExpr(trIdent: string, id: string, normalizedText: string, rawText?: string): string {
  const raw = rawText ?? normalizedText;
  const needsLeadingSpace = /^\s/.test(raw);
  const needsTrailingSpace = /\s$/.test(raw);

  const parts: string[] = [];
  if (needsLeadingSpace) parts.push(JSON.stringify(" "));
  parts.push(`${trIdent}("${id}", ${JSON.stringify(normalizedText)})`);
  if (needsTrailingSpace) parts.push(JSON.stringify(" "));
  return parts.join(" + ");
}

function hasI18nDisablePragma(code: string): boolean {
  return /i18n-disable/i.test(code);
}

function hasMeaningfulJsxSibling(node: any): boolean {
  if (!node) return false;
  if (node.type === "JSXText") return normalizeText(String(node.value ?? "")) !== "";
  if (node.type === "JSXExpressionContainer") {
    const exprType = node.expression?.type;
    return exprType && exprType !== "JSXEmptyExpression";
  }
  return true;
}

function importInsertPos(code: string): number {
  const m = code.match(/^\s*\/\/\s*@ts-nocheck[^\n]*\n/);
  return m ? m[0].length : 0;
}

type ManifestFile = {
  schema: 1;
  generatedAt: number;
  version: string;
  entries: ManifestEntry[];
};

export function autoI18nPlugin(): Plugin {
  let config: ResolvedConfig | null = null;
  const manifest = new Map<string, ManifestEntry>();
  let writeTimer: NodeJS.Timeout | null = null;

  function getManifestFile(): ManifestFile {
    const entries = Array.from(manifest.values()).sort((a, b) => a.id.localeCompare(b.id));
    const hashPayload = JSON.stringify(entries.map((e) => [e.id, e.defaultText]));
    const version = createHash("sha256").update(hashPayload).digest("hex");
    return { schema: 1, generatedAt: Date.now(), version, entries };
  }

  async function writeManifestToDisk() {
    if (!config) return;
    const mf = getManifestFile();
    const outPath = path.resolve(config.root, "i18n-manifest.json");
    try {
      await fs.writeFile(outPath, JSON.stringify(mf, null, 2), "utf8");
    } catch {
      // best-effort
    }
  }

  function scheduleManifestWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void writeManifestToDisk();
    }, 250);
  }

  return {
    name: "tradehub-auto-i18n",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      manifest.clear();
    },
    transform(code, id) {
      if (!config) return null;
      if (hasI18nDisablePragma(code)) return null;
      if (id.includes("node_modules")) return null;
      if (id.startsWith("\u0000")) return null;

      const filePath = id.split("?")[0];
      const relFile = path.relative(config.root, filePath).replace(/\\/g, "/");
      const ext = path.extname(filePath).toLowerCase();
      const isJsxLike = ext === ".tsx" || ext === ".jsx" || ext === ".ts" || ext === ".js";
      if (!isJsxLike) return null;

      let ast: any;
      try {
        ast = parse(code, {
          sourceType: "module",
          plugins: [
            "jsx",
            "typescript",
            // These make parsing more tolerant of modern syntax used by Vite/React ecosystems.
            "importMeta",
            "topLevelAwait",
          ],
          errorRecovery: true,
        });
      } catch {
        return null;
      }

      const s = new MagicString(code);

      const trIdent = /\b__tr\b/.test(code) ? "__i18n_tr" : "__tr";
      let needsImport = true;
      let didChange = false;

      traverse(ast, {
        ImportDeclaration(p: any) {
          if (p?.node?.source?.value !== "@/i18n") return;
          for (const spec of p.node.specifiers || []) {
            if (spec.type === "ImportSpecifier" && spec.imported?.name === "tr" && spec.local?.name === trIdent) {
              needsImport = false;
            }
          }
        },
        JSXText(p: any) {
          const raw = String(p.node.value ?? "");
          const text = normalizeText(raw);
          if (!looksTranslatable(text)) return;

          const id2 = stableId({ file: relFile, kind: "JSXText", text });
          if (!manifest.has(id2)) {
            manifest.set(id2, { id: id2, defaultText: text, file: relFile, kind: "JSXText", ...nodeLoc(p.node) });
          }

          if (typeof p.node.start !== "number" || typeof p.node.end !== "number") return;
          const siblings = (p.parent as any)?.children as any[] | undefined;
          const idx = typeof p.key === "number" ? p.key : -1;
          const hasPrev = Array.isArray(siblings) && idx > 0
            ? siblings.slice(0, idx).some((n) => hasMeaningfulJsxSibling(n))
            : false;
          const hasNext = Array.isArray(siblings) && idx >= 0 && idx < siblings.length - 1
            ? siblings.slice(idx + 1).some((n) => hasMeaningfulJsxSibling(n))
            : false;

          const needsLeadingSpace = /^\s/.test(raw) && hasPrev;
          const needsTrailingSpace = /\s$/.test(raw) && hasNext;

          const parts: string[] = [];
          if (needsLeadingSpace) parts.push(JSON.stringify(" "));
          parts.push(`${trIdent}("${id2}", ${JSON.stringify(text)})`);
          if (needsTrailingSpace) parts.push(JSON.stringify(" "));

          s.overwrite(p.node.start, p.node.end, `{${parts.join(" + ")}}`);
          didChange = true;
        },
        JSXExpressionContainer(p: any) {
          const ctx = jsxExpressionContainerContext(p);
          if (!ctx) return;

          const expr = p.node.expression;
          const str = stringLikeText(expr);
          if (!str) return;
          if (!looksTranslatable(str.text)) return;
          if (typeof expr.start !== "number" || typeof expr.end !== "number") return;

          const id2 = stableId({ file: relFile, kind: "JSXExpr", text: str.text, propName: ctx.propName });
          if (!manifest.has(id2)) {
            manifest.set(id2, {
              id: id2,
              defaultText: str.text,
              file: relFile,
              kind: "JSXExpr",
              propName: ctx.propName,
              ...nodeLoc(expr),
            });
          }

          s.overwrite(expr.start, expr.end, renderTrExpr(trIdent, id2, str.text, str.raw));
          didChange = true;
        },
        ConditionalExpression(p: any) {
          const ctx = findJsxExpressionContext(p);
          if (!ctx) return;

          const cons = p.node.consequent;
          const alt = p.node.alternate;

          const consStr = stringLikeText(cons);
          if (consStr && looksTranslatable(consStr.text) && typeof cons.start === "number" && typeof cons.end === "number") {
            const id2 = stableId({ file: relFile, kind: "JSXExpr", text: consStr.text, propName: ctx.propName });
            if (!manifest.has(id2)) {
              manifest.set(id2, {
                id: id2,
                defaultText: consStr.text,
                file: relFile,
                kind: "JSXExpr",
                propName: ctx.propName,
                ...nodeLoc(cons),
              });
            }
            s.overwrite(cons.start, cons.end, renderTrExpr(trIdent, id2, consStr.text, consStr.raw));
            didChange = true;
          }

          const altStr = stringLikeText(alt);
          if (altStr && looksTranslatable(altStr.text) && typeof alt.start === "number" && typeof alt.end === "number") {
            const id2 = stableId({ file: relFile, kind: "JSXExpr", text: altStr.text, propName: ctx.propName });
            if (!manifest.has(id2)) {
              manifest.set(id2, {
                id: id2,
                defaultText: altStr.text,
                file: relFile,
                kind: "JSXExpr",
                propName: ctx.propName,
                ...nodeLoc(alt),
              });
            }
            s.overwrite(alt.start, alt.end, renderTrExpr(trIdent, id2, altStr.text, altStr.raw));
            didChange = true;
          }
        },
        LogicalExpression(p: any) {
          const ctx = findJsxExpressionContext(p);
          if (!ctx) return;
          const op = String(p.node.operator || "");
          if (op !== "&&" && op !== "||" && op !== "??") return;

          const right = p.node.right;
          const rightStr = stringLikeText(right);
          if (!rightStr) return;
          if (!looksTranslatable(rightStr.text)) return;
          if (typeof right.start !== "number" || typeof right.end !== "number") return;

          const id2 = stableId({ file: relFile, kind: "JSXExpr", text: rightStr.text, propName: ctx.propName });
          if (!manifest.has(id2)) {
            manifest.set(id2, {
              id: id2,
              defaultText: rightStr.text,
              file: relFile,
              kind: "JSXExpr",
              propName: ctx.propName,
              ...nodeLoc(right),
            });
          }

          s.overwrite(right.start, right.end, renderTrExpr(trIdent, id2, rightStr.text, rightStr.raw));
          didChange = true;
        },
        JSXAttribute(p: any) {
          const nameNode = p.node.name;
          const name =
            nameNode?.type === "JSXIdentifier"
              ? String(nameNode.name)
              : nameNode?.type === "JSXNamespacedName"
                ? `${nameNode.namespace?.name}:${nameNode.name?.name}`
                : "";
          if (!TRANSLATABLE_JSX_ATTRS.has(name)) return;

          const v = p.node.value;
          if (!v || v.type !== "StringLiteral") return;

          const text = normalizeText(String(v.value ?? ""));
          if (!looksTranslatable(text)) return;

          const id2 = stableId({ file: relFile, kind: "JSXAttr", text, propName: name });
          if (!manifest.has(id2)) {
            manifest.set(id2, {
              id: id2,
              defaultText: text,
              file: relFile,
              kind: "JSXAttr",
              propName: name,
              ...nodeLoc(v),
            });
          }

          if (typeof v.start !== "number" || typeof v.end !== "number") return;
          s.overwrite(v.start, v.end, `{${trIdent}("${id2}", ${JSON.stringify(text)})}`);
          didChange = true;
        },
        ObjectProperty(p: any) {
          const key = p.node.key;
          const propName =
            key?.type === "Identifier"
              ? String(key.name)
              : key?.type === "StringLiteral"
                ? String(key.value)
                : "";
          if (!TRANSLATABLE_OBJECT_KEYS.has(propName)) return;

          const v = p.node.value;
          if (!v) return;

          const direct = stringLikeText(v);
          if (direct && looksTranslatable(direct.text) && typeof v.start === "number" && typeof v.end === "number") {
            const id2 = stableId({ file: relFile, kind: "ObjectProp", text: direct.text, propName });
            if (!manifest.has(id2)) {
              manifest.set(id2, {
                id: id2,
                defaultText: direct.text,
                file: relFile,
                kind: "ObjectProp",
                propName,
                ...nodeLoc(v),
              });
            }
            s.overwrite(v.start, v.end, renderTrExpr(trIdent, id2, direct.text, direct.raw));
            didChange = true;
            return;
          }

          if (v.type === "ConditionalExpression") {
            const cons = v.consequent;
            const alt = v.alternate;

            const consStr = stringLikeText(cons);
            if (consStr && looksTranslatable(consStr.text) && typeof cons.start === "number" && typeof cons.end === "number") {
              const id2 = stableId({ file: relFile, kind: "ObjectProp", text: consStr.text, propName });
              if (!manifest.has(id2)) {
                manifest.set(id2, {
                  id: id2,
                  defaultText: consStr.text,
                  file: relFile,
                  kind: "ObjectProp",
                  propName,
                  ...nodeLoc(cons),
                });
              }
              s.overwrite(cons.start, cons.end, renderTrExpr(trIdent, id2, consStr.text, consStr.raw));
              didChange = true;
            }

            const altStr = stringLikeText(alt);
            if (altStr && looksTranslatable(altStr.text) && typeof alt.start === "number" && typeof alt.end === "number") {
              const id2 = stableId({ file: relFile, kind: "ObjectProp", text: altStr.text, propName });
              if (!manifest.has(id2)) {
                manifest.set(id2, {
                  id: id2,
                  defaultText: altStr.text,
                  file: relFile,
                  kind: "ObjectProp",
                  propName,
                  ...nodeLoc(alt),
                });
              }
              s.overwrite(alt.start, alt.end, renderTrExpr(trIdent, id2, altStr.text, altStr.raw));
              didChange = true;
            }
            return;
          }

          if (v.type === "LogicalExpression") {
            const op = String(v.operator || "");
            if (op !== "||" && op !== "??") return;
            const right = v.right;
            const rightStr = stringLikeText(right);
            if (!rightStr || !looksTranslatable(rightStr.text)) return;
            if (typeof right.start !== "number" || typeof right.end !== "number") return;

            const id2 = stableId({ file: relFile, kind: "ObjectProp", text: rightStr.text, propName });
            if (!manifest.has(id2)) {
              manifest.set(id2, {
                id: id2,
                defaultText: rightStr.text,
                file: relFile,
                kind: "ObjectProp",
                propName,
                ...nodeLoc(right),
              });
            }

            s.overwrite(right.start, right.end, renderTrExpr(trIdent, id2, rightStr.text, rightStr.raw));
            didChange = true;
          }
        },
      });

      if (!didChange) return null;

      if (needsImport) {
        const pos = importInsertPos(code);
        s.appendLeft(pos, `import { tr as ${trIdent} } from "@/i18n";\n`);
      }

      scheduleManifestWrite();

      return {
        code: s.toString(),
        map: s.generateMap({ hires: true }),
      };
    },
    async generateBundle() {
      const mf = getManifestFile();
      this.emitFile({
        type: "asset",
        fileName: "i18n-manifest.json",
        source: JSON.stringify(mf, null, 2),
      });
      await writeManifestToDisk();
    },
  };
}
